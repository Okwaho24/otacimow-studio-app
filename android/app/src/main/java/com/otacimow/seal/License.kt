package com.otacimow.seal

import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.security.KeyFactory
import java.security.PublicKey
import java.security.Signature
import java.security.SignatureException
import java.security.interfaces.ECPublicKey
import java.security.spec.X509EncodedKeySpec
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.Base64

/**
 * Otâcimow license tokens.
 *
 * Token = "OTC1." + base64url(payload) + "." + base64url(ECDSA-P256-SHA256 signature, DER)
 * Payload = UTF-8 text, one "key=value" per line, no trailing newline:
 *   v=1
 *   tid=<opaque transaction id>
 *   sku=otacimow
 *   iat=<ISO-8601 UTC instant>
 *   exp=<ISO-8601 UTC instant>          (optional)
 *
 * The app holds only the PUBLIC key. Tokens carry no personal data.
 */
const val LICENSE_PREFIX = "OTC1"
const val LICENSE_SKU = "otacimow"
const val MAX_TOKEN_CHARS = 2048

/** Allowed clock skew between the issuing server and the device. */
internal val CLOCK_SKEW: Duration = Duration.ofDays(1)

enum class LicenseError { MALFORMED, UNSUPPORTED_VERSION, BAD_SIGNATURE, WRONG_SKU, NOT_YET_VALID, EXPIRED }

data class License(
  val tid: String,
  val sku: String,
  val iat: Instant,
  val exp: Instant?,
  val token: String,
)

sealed class LicenseResult {
  data class Valid(val license: License) : LicenseResult()
  data class Invalid(val reason: LicenseError) : LicenseResult()
}

/** Strict "key=value" line codec shared by licenses and seals. */
internal object Kv {
  private val KEY = Regex("^[a-z][a-z0-9_]{0,15}$")
  private val VALUE = Regex("^[A-Za-z0-9._:+-]{1,2048}$")

  fun parse(bytes: ByteArray): Map<String, String>? {
    val text = try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
    } catch (e: CharacterCodingException) {
      return null
    }
    if (text.isEmpty()) return null
    val out = LinkedHashMap<String, String>()
    for (line in text.split('\n')) {
      val i = line.indexOf('=')
      if (i <= 0) return null
      val k = line.substring(0, i)
      val v = line.substring(i + 1)
      if (!KEY.matches(k) || !VALUE.matches(v)) return null
      if (out.put(k, v) != null) return null // duplicate key
    }
    return out
  }

  fun build(pairs: List<Pair<String, String>>): ByteArray {
    val sb = StringBuilder()
    for ((idx, p) in pairs.withIndex()) {
      require(KEY.matches(p.first)) { "bad key ${p.first}" }
      require(VALUE.matches(p.second)) { "bad value for ${p.first}" }
      if (idx > 0) sb.append('\n')
      sb.append(p.first).append('=').append(p.second)
    }
    return sb.toString().toByteArray(Charsets.UTF_8)
  }
}

class LicenseVerifier(publicKeyDer: ByteArray) {
  private val key: PublicKey = KeyFactory.getInstance("EC")
    .generatePublic(X509EncodedKeySpec(publicKeyDer))

  init {
    val ec = key as? ECPublicKey ?: throw IllegalArgumentException("license key is not an EC key")
    require(ec.params.curve.field.fieldSize == 256) { "license key must be P-256" }
  }

  companion object {
    fun fromPem(pem: String): LicenseVerifier {
      val b64 = pem.lineSequence()
        .map { it.trim() }
        .filter { it.isNotEmpty() && !it.startsWith("-----") }
        .joinToString("")
      require(b64.isNotEmpty()) { "empty PEM" }
      return LicenseVerifier(Base64.getDecoder().decode(b64))
    }
  }

  /** Signature, version and SKU checks only; no time checks. */
  internal fun parseSigned(token: String): LicenseResult {
    if (token.length > MAX_TOKEN_CHARS) return LicenseResult.Invalid(LicenseError.MALFORMED)
    val parts = token.trim().split('.')
    if (parts.size != 3 || parts[0] != LICENSE_PREFIX) return LicenseResult.Invalid(LicenseError.MALFORMED)
    val payload: ByteArray
    val sig: ByteArray
    try {
      payload = Base64.getUrlDecoder().decode(parts[1])
      sig = Base64.getUrlDecoder().decode(parts[2])
    } catch (e: IllegalArgumentException) {
      return LicenseResult.Invalid(LicenseError.MALFORMED)
    }
    val ok = try {
      Signature.getInstance("SHA256withECDSA").run {
        initVerify(key)
        update(payload)
        verify(sig)
      }
    } catch (e: SignatureException) {
      false
    }
    if (!ok) return LicenseResult.Invalid(LicenseError.BAD_SIGNATURE)

    val kv = Kv.parse(payload) ?: return LicenseResult.Invalid(LicenseError.MALFORMED)
    if (kv["v"] != "1") return LicenseResult.Invalid(LicenseError.UNSUPPORTED_VERSION)
    val tid = kv["tid"] ?: return LicenseResult.Invalid(LicenseError.MALFORMED)
    val sku = kv["sku"] ?: return LicenseResult.Invalid(LicenseError.MALFORMED)
    if (sku != LICENSE_SKU) return LicenseResult.Invalid(LicenseError.WRONG_SKU)
    val iat = parseInstant(kv["iat"]) ?: return LicenseResult.Invalid(LicenseError.MALFORMED)
    val expRaw = kv["exp"]
    val exp = if (expRaw == null) null else (parseInstant(expRaw) ?: return LicenseResult.Invalid(LicenseError.MALFORMED))
    return LicenseResult.Valid(License(tid, sku, iat, exp, token.trim()))
  }

  fun check(token: String, now: Instant): LicenseResult {
    val parsed = parseSigned(token)
    if (parsed !is LicenseResult.Valid) return parsed
    val lic = parsed.license
    if (lic.iat.isAfter(now.plus(CLOCK_SKEW))) return LicenseResult.Invalid(LicenseError.NOT_YET_VALID)
    if (lic.exp != null && now.isAfter(lic.exp)) return LicenseResult.Invalid(LicenseError.EXPIRED)
    return parsed
  }

  private fun parseInstant(s: String?): Instant? =
    if (s == null) null else try { Instant.parse(s) } catch (e: DateTimeParseException) { null }
}
