package com.otacimow.seal

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.time.Instant
import java.util.Base64

/** Test-only issuer. The production private key never exists in this repository. */
private class TestIssuer {
  val pair: KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
  val verifier = LicenseVerifier(pair.public.encoded)

  fun token(
    tid: String = "TEST-0001",
    sku: String = "otacimow",
    iat: String = "2026-10-21T00:00:00Z",
    exp: String? = null,
    v: String = "1",
  ): String {
    val lines = mutableListOf("v=$v", "tid=$tid", "sku=$sku", "iat=$iat")
    if (exp != null) lines.add("exp=$exp")
    return sign(lines.joinToString("\n").toByteArray())
  }

  fun sign(payload: ByteArray): String {
    val sig = Signature.getInstance("SHA256withECDSA").run {
      initSign(pair.private); update(payload); sign()
    }
    val e = Base64.getUrlEncoder().withoutPadding()
    return "OTC1.${e.encodeToString(payload)}.${e.encodeToString(sig)}"
  }
}

private val NOW: Instant = Instant.parse("2026-10-21T12:00:00Z")

class LicenseTest {
  private val issuer = TestIssuer()

  private fun invalid(token: String, now: Instant = NOW): LicenseError {
    val r = issuer.verifier.check(token, now)
    assertTrue("expected invalid, got $r", r is LicenseResult.Invalid)
    return (r as LicenseResult.Invalid).reason
  }

  @Test fun validTokenParses() {
    val r = issuer.verifier.check(issuer.token(tid = "ABCD-1234"), NOW)
    assertTrue(r is LicenseResult.Valid)
    val lic = (r as LicenseResult.Valid).license
    assertEquals("ABCD-1234", lic.tid)
    assertEquals("otacimow", lic.sku)
    assertEquals(null, lic.exp)
  }

  @Test fun otherIssuerKeyIsRejected() {
    val other = TestIssuer()
    assertEquals(LicenseError.BAD_SIGNATURE, invalid(other.token()))
  }

  @Test fun tamperedPayloadIsRejected() {
    val t = issuer.token(tid = "AAAA-0001")
    val parts = t.split('.')
    val forged = Base64.getUrlEncoder().withoutPadding().encodeToString(
      String(Base64.getUrlDecoder().decode(parts[1])).replace("AAAA-0001", "BBBB-0001").toByteArray()
    )
    assertEquals(LicenseError.BAD_SIGNATURE, invalid("OTC1.$forged.${parts[2]}"))
  }

  @Test fun expiryIsEnforced() {
    val t = issuer.token(exp = "2026-10-22T00:00:00Z")
    assertTrue(issuer.verifier.check(t, NOW) is LicenseResult.Valid)
    assertEquals(LicenseError.EXPIRED, invalid(t, Instant.parse("2026-10-22T00:00:01Z")))
  }

  @Test fun futureIssueBeyondSkewIsRejected() {
    val t = issuer.token(iat = "2026-10-25T00:00:00Z")
    assertEquals(LicenseError.NOT_YET_VALID, invalid(t))
    // within one day of skew is accepted
    assertTrue(issuer.verifier.check(issuer.token(iat = "2026-10-22T06:00:00Z"), NOW) is LicenseResult.Valid)
  }

  @Test fun wrongSkuAndVersionAreRejected() {
    assertEquals(LicenseError.WRONG_SKU, invalid(issuer.token(sku = "other")))
    assertEquals(LicenseError.UNSUPPORTED_VERSION, invalid(issuer.token(v = "2")))
  }

  @Test fun malformedTokensAreRejected() {
    for (bad in listOf("", "OTC1", "OTC1.a", "OTC1.a.b.c", "XXX1.a.b", "OTC1.!!!.???", "OTC1..", "x".repeat(MAX_TOKEN_CHARS + 1))) {
      val r = issuer.verifier.check(bad, NOW)
      assertTrue("accepted: $bad", r is LicenseResult.Invalid)
    }
  }

  @Test fun duplicateKeysAndBadCharsAreRejected() {
    assertEquals(LicenseError.MALFORMED, invalid(issuer.sign("v=1\ntid=A\ntid=B\nsku=otacimow\niat=2026-10-21T00:00:00Z".toByteArray())))
    assertEquals(LicenseError.MALFORMED, invalid(issuer.sign("v=1\ntid=A B\nsku=otacimow\niat=2026-10-21T00:00:00Z".toByteArray())))
    assertEquals(LicenseError.MALFORMED, invalid(issuer.sign("v=1\ntid=AAAA\nsku=otacimow\niat=not-a-date".toByteArray())))
    assertEquals(LicenseError.MALFORMED, invalid(issuer.sign(byteArrayOf(0xC3.toByte(), 0x28))))
  }

  @Test fun nonP256KeyIsRejectedAtConstruction() {
    val rsa = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    try {
      LicenseVerifier(rsa.public.encoded)
      fail("RSA key accepted")
    } catch (e: Exception) { /* expected */ }
  }
}

class SealTest {
  @get:Rule val tmp = TemporaryFolder()
  private val issuer = TestIssuer()
  private val license: License
    get() = (issuer.verifier.check(issuer.token(tid = "SEAL-0001"), NOW) as LicenseResult.Valid).license

  private fun box(type: String, body: ByteArray): ByteArray =
    ByteBuffer.allocate(8 + body.size).putInt(8 + body.size).put(type.toByteArray()).put(body).array()

  private fun miniMp4(extra: List<ByteArray> = emptyList()): ByteArray {
    val o = ByteArrayOutputStream()
    o.write(box("ftyp", "isom\u0000\u0000\u0002\u0000isomiso2".toByteArray(Charsets.ISO_8859_1)))
    o.write(box("moov", ByteArray(40) { it.toByte() }))
    o.write(box("mdat", ByteArray(5000) { (it * 7).toByte() }))
    extra.forEach { o.write(it) }
    return o.toByteArray()
  }

  private fun file(bytes: ByteArray): File = tmp.newFile().also { it.writeBytes(bytes) }
  private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
  private fun verify(f: File) = Mp4Seal.verify(f, issuer.verifier)

  @Test fun sealThenVerifyIsValid() {
    val orig = miniMp4()
    val f = file(orig)
    val info = Mp4Seal.seal(f, license, NOW)
    assertEquals(sha(orig), info.sha256)
    assertEquals("SEAL-0001", info.tid)
    val r = verify(f)
    assertEquals(VerifyStatus.VALID, r.status)
    assertEquals("SEAL-0001", r.tid)
    assertEquals(NOW, r.ts)
    assertEquals(sha(orig), r.sha256)
    // the original bytes are untouched: the seal is appended only
    val sealed = f.readBytes()
    assertArrayEquals(orig, sealed.copyOfRange(0, orig.size))
    assertTrue(sealed.size > orig.size)
  }

  @Test fun sealingTwiceIsRefused() {
    val f = file(miniMp4())
    Mp4Seal.seal(f, license, NOW)
    try { Mp4Seal.seal(f, license, NOW); fail("second seal accepted") }
    catch (e: SealException) { assertEquals(SealError.ALREADY_SEALED, e.code) }
  }

  @Test fun nonMp4IsRefusedAndLeftUntouched() {
    val junk = ByteArray(300) { 7 }
    val f = file(junk)
    try { Mp4Seal.seal(f, license, NOW); fail("non-mp4 sealed") }
    catch (e: SealException) { assertEquals(SealError.NOT_MP4, e.code) }
    assertArrayEquals(junk, f.readBytes())
    assertEquals(VerifyStatus.NOT_MP4, verify(f).status)
    assertEquals(VerifyStatus.NOT_MP4, verify(file(ByteArray(0))).status)
  }

  @Test fun truncatedAndOverlongBoxesAreMalformed() {
    val good = miniMp4()
    assertEquals(VerifyStatus.MALFORMED_FILE, verify(file(good.copyOfRange(0, good.size - 100))).status)
    val bad = good.copyOf(); ByteBuffer.wrap(bad).putInt(0, 5) // size < header
    assertEquals(VerifyStatus.MALFORMED_FILE, verify(file(bad)).status)
  }

  @Test fun boxExtendingToEofCannotBeSealed() {
    val o = ByteArrayOutputStream()
    o.write(box("ftyp", "isom\u0000\u0000\u0002\u0000".toByteArray(Charsets.ISO_8859_1)))
    val mdat = ByteBuffer.allocate(8 + 100).putInt(0).put("mdat".toByteArray()).array()
    o.write(mdat)
    val f = file(o.toByteArray())
    try { Mp4Seal.seal(f, license, NOW); fail("sealed") }
    catch (e: SealException) { assertEquals(SealError.UNSUPPORTED_LAYOUT, e.code) }
  }

  @Test fun largeSizeBoxHeaderIsHandled() {
    val o = ByteArrayOutputStream()
    o.write(box("ftyp", "isom\u0000\u0000\u0002\u0000".toByteArray(Charsets.ISO_8859_1)))
    val body = ByteArray(2000) { 3 }
    o.write(ByteBuffer.allocate(16 + body.size).putInt(1).put("mdat".toByteArray()).putLong((16 + body.size).toLong()).put(body).array())
    val f = file(o.toByteArray())
    Mp4Seal.seal(f, license, NOW)
    assertEquals(VerifyStatus.VALID, verify(f).status)
  }

  @Test fun editedContentIsDetected() {
    val f = file(miniMp4())
    Mp4Seal.seal(f, license, NOW)
    val b = f.readBytes(); b[200] = (b[200] + 1).toByte(); f.writeBytes(b)
    val r = verify(f)
    assertEquals(VerifyStatus.TAMPERED_CONTENT, r.status)
    assertEquals("SEAL-0001", r.tid)
  }

  @Test fun dataAfterSealIsDetected() {
    val f = file(miniMp4())
    Mp4Seal.seal(f, license, NOW)
    f.appendBytes(box("free", ByteArray(16)))
    assertEquals(VerifyStatus.TAMPERED_TRAILING, verify(f).status)
    val g = file(miniMp4()); Mp4Seal.seal(g, license, NOW); g.appendBytes(byteArrayOf(1, 2, 3))
    assertEquals(VerifyStatus.MALFORMED_FILE, verify(g).status)
  }

  @Test fun strippedSealReportsNoSeal() {
    val orig = miniMp4()
    val f = file(orig)
    Mp4Seal.seal(f, license, NOW)
    f.writeBytes(f.readBytes().copyOfRange(0, orig.size))
    assertEquals(VerifyStatus.NO_SEAL, verify(f).status)
  }

  @Test fun forgedDeclaredHashIsDetected() {
    val f = file(miniMp4())
    val info = Mp4Seal.seal(f, license, NOW)
    val text = f.readBytes()
    val s = String(text, Charsets.ISO_8859_1).replace(info.sha256, "0".repeat(64))
    f.writeBytes(s.toByteArray(Charsets.ISO_8859_1))
    assertEquals(VerifyStatus.TAMPERED_CONTENT, verify(f).status)
  }

  @Test fun tokenFromAnotherIssuerIsRejectedInSeal() {
    val f = file(miniMp4())
    val foreign = TestIssuer()
    val foreignLic = (foreign.verifier.check(foreign.token(), NOW) as LicenseResult.Valid).license
    Mp4Seal.seal(f, foreignLic, NOW) // sealing does not check the signer; verification does
    val r = verify(f)
    assertEquals(VerifyStatus.BAD_LICENSE, r.status)
    assertEquals(LicenseError.BAD_SIGNATURE, r.licenseError)
  }

  @Test fun sealOutsideLicenseWindowIsRejected() {
    val t = issuer.token(tid = "WIN-0001", exp = "2026-10-22T00:00:00Z")
    val lic = (issuer.verifier.check(t, NOW) as LicenseResult.Valid).license
    val late = file(miniMp4()); Mp4Seal.seal(late, lic, Instant.parse("2026-10-23T00:00:00Z"))
    assertEquals(LicenseError.EXPIRED, verify(late).licenseError)
    val early = file(miniMp4()); Mp4Seal.seal(early, lic, Instant.parse("2026-10-01T00:00:00Z"))
    assertEquals(LicenseError.NOT_YET_VALID, verify(early).licenseError)
  }

  @Test fun failedWriteLeavesFileIntact() {
    val orig = miniMp4()
    val f = file(orig)
    f.setReadOnly()
    // Root (e.g. some CI containers) ignores file modes; the scenario cannot be produced there.
    org.junit.Assume.assumeFalse("running as a user that can write read-only files", f.canWrite())
    try { Mp4Seal.seal(f, license, NOW); fail("sealed a read-only file") }
    catch (e: SealException) { assertEquals(SealError.IO, e.code) }
    assertArrayEquals(orig, f.readBytes())
  }
}

/** Interop with the Node reference implementation (tools/license-lib.mjs). */
class VectorTest {
  private fun res(name: String): ByteArray =
    javaClass.getResourceAsStream("/vectors/$name")?.readBytes() ?: throw AssertionError("missing vector $name")

  private val verifier = LicenseVerifier.fromPem(String(res("license_pub.pem")))
  private val at = Instant.parse("2026-10-21T12:00:00Z")

  @Test fun nodeIssuedTokenVerifies() {
    val r = verifier.check(String(res("token_valid.txt")).trim(), at)
    assertTrue("got $r", r is LicenseResult.Valid)
    assertEquals("TEST-VECTOR-0001", (r as LicenseResult.Valid).license.tid)
  }

  @Test fun nodeIssuedExpiringTokenExpires() {
    val t = String(res("token_expiring.txt")).trim()
    assertTrue(verifier.check(t, at) is LicenseResult.Valid)
    assertEquals(LicenseError.EXPIRED, (verifier.check(t, Instant.parse("2026-10-23T00:00:00Z")) as LicenseResult.Invalid).reason)
  }

  @Test fun nodeSealedRealMp4Verifies() {
    val f = File.createTempFile("vec", ".mp4").apply { deleteOnExit(); writeBytes(res("sample_sealed_node.mp4")) }
    val r = Mp4Seal.verify(f, verifier)
    assertEquals(VerifyStatus.VALID, r.status)
    assertEquals("TEST-VECTOR-0001", r.tid)
    assertEquals(Instant.parse("2026-10-21T12:00:00Z"), r.ts)
  }

  @Test fun kotlinSealOfRealMp4MatchesNodeBytes() {
    val orig = File.createTempFile("vec", ".mp4").apply { deleteOnExit(); writeBytes(res("sample.mp4")) }
    val lic = (verifier.check(String(res("token_valid.txt")).trim(), at) as LicenseResult.Valid).license
    Mp4Seal.seal(orig, lic, Instant.parse("2026-10-21T12:00:00Z"))
    assertArrayEquals("Kotlin and Node seals must be byte-identical", res("sample_sealed_node.mp4"), orig.readBytes())
    assertNotNull(Mp4Seal.verify(orig, verifier))
  }
}
