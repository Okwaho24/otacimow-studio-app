package com.otacimow.seal

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Instant
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit

/**
 * AcerbE seal for MP4 exports.
 *
 * A seal is one top-level ISO-BMFF `free` box APPENDED after the last box of the
 * finished file (after the faststart pass). Players ignore `free` boxes.
 *
 *   box  = size(4, BE) "free" body
 *   body = "OTCSEAL1"(8) payloadLen(4, BE) payload
 *   payload (key=value lines): v=1, sha256=<hex of every byte before the seal box>,
 *                              ts=<ISO-8601 UTC>, tok=<license token>
 *
 * Appending (never prepending) leaves every absolute chunk offset in the file valid.
 *
 * What a VALID result proves: the bytes before the seal are exactly what was sealed,
 * and the seal carries a license token signed by the Otâcimow issuer. It does NOT
 * prove who made the file on its own: anyone holding a token could stamp a seal.
 * Attribution is authoritative only when the hash is also in the issuer's registry.
 * Any re-encode or remux removes the seal.
 */
const val SEAL_MAGIC = "OTCSEAL1"
internal const val MAX_SEAL_PAYLOAD = 4096
private const val MAX_BOXES = 200_000
private val HEX64 = Regex("^[0-9a-f]{64}$")

enum class SealError { NOT_MP4, MALFORMED_MP4, ALREADY_SEALED, UNSUPPORTED_LAYOUT, PAYLOAD_TOO_LARGE, IO }

class SealException(val code: SealError, message: String, cause: Throwable? = null) : Exception(message, cause)

enum class VerifyStatus {
  VALID,
  NO_SEAL,
  TAMPERED_CONTENT,
  TAMPERED_TRAILING,
  BAD_LICENSE,
  MALFORMED_SEAL,
  MALFORMED_FILE,
  NOT_MP4,
}

data class SealInfo(val sha256: String, val tid: String, val ts: Instant)

data class VerifyResult(
  val status: VerifyStatus,
  val tid: String? = null,
  val ts: Instant? = null,
  val sha256: String? = null,
  val licenseError: LicenseError? = null,
)

object Mp4Seal {

  private class Box(val start: Long, val size: Long, val type: String, val headerLen: Int, val toEof: Boolean)

  /** Appends a seal to [file] in place. The caller must have checked [license] first. */
  fun seal(file: File, license: License, now: Instant): SealInfo {
    try {
      RandomAccessFile(file, "rw").use { raf ->
        val boxes = walk(raf)
        if (boxes.any { isSeal(raf, it) }) throw SealException(SealError.ALREADY_SEALED, "file is already sealed")
        if (boxes.last().toEof) throw SealException(SealError.UNSUPPORTED_LAYOUT, "last box extends to end of file")

        val origLen = raf.length()
        val hash = toHex(sha256(raf, origLen))
        val ts = now.truncatedTo(ChronoUnit.SECONDS)
        val payload = Kv.build(
          listOf("v" to "1", "sha256" to hash, "ts" to ts.toString(), "tok" to license.token)
        )
        if (payload.size > MAX_SEAL_PAYLOAD) throw SealException(SealError.PAYLOAD_TOO_LARGE, "seal payload too large")

        val magic = SEAL_MAGIC.toByteArray(Charsets.US_ASCII)
        val atomSize = 8 + magic.size + 4 + payload.size
        val buf = ByteBuffer.allocate(atomSize)
        buf.putInt(atomSize)
        buf.put("free".toByteArray(Charsets.US_ASCII))
        buf.put(magic)
        buf.putInt(payload.size)
        buf.put(payload)

        try {
          raf.seek(origLen)
          raf.write(buf.array())
          raf.channel.force(true)
        } catch (e: IOException) {
          try { raf.setLength(origLen) } catch (_: IOException) { /* best effort rollback */ }
          throw SealException(SealError.IO, "could not write seal", e)
        }
        return SealInfo(hash, license.tid, ts)
      }
    } catch (e: IOException) {
      throw SealException(SealError.IO, "could not read file", e)
    }
  }

  /** Full verification. Never modifies the file. */
  fun verify(file: File, verifier: LicenseVerifier): VerifyResult {
    try {
      RandomAccessFile(file, "r").use { raf ->
        val boxes = try {
          walk(raf)
        } catch (e: SealException) {
          return VerifyResult(if (e.code == SealError.NOT_MP4) VerifyStatus.NOT_MP4 else VerifyStatus.MALFORMED_FILE)
        }

        val seals = boxes.filter { isSeal(raf, it) }
        if (seals.isEmpty()) return VerifyResult(VerifyStatus.NO_SEAL)
        if (seals.size > 1) return VerifyResult(VerifyStatus.MALFORMED_SEAL)
        val sealBox = seals[0]
        if (sealBox !== boxes.last()) return VerifyResult(VerifyStatus.TAMPERED_TRAILING)

        val bodyLen = sealBox.size - sealBox.headerLen
        if (bodyLen < 12 || bodyLen > 12 + MAX_SEAL_PAYLOAD) return VerifyResult(VerifyStatus.MALFORMED_SEAL)
        raf.seek(sealBox.start + sealBox.headerLen + 8)
        val payloadLen = raf.readInt()
        if (payloadLen < 0 || payloadLen.toLong() != bodyLen - 12) return VerifyResult(VerifyStatus.MALFORMED_SEAL)
        val payload = ByteArray(payloadLen)
        raf.readFully(payload)

        val kv = Kv.parse(payload) ?: return VerifyResult(VerifyStatus.MALFORMED_SEAL)
        val declared = kv["sha256"]
        val tok = kv["tok"]
        val ts = try { kv["ts"]?.let { Instant.parse(it) } } catch (e: DateTimeParseException) { null }
        if (kv["v"] != "1" || declared == null || !HEX64.matches(declared) || tok == null || ts == null) {
          return VerifyResult(VerifyStatus.MALFORMED_SEAL)
        }

        val parsed = verifier.parseSigned(tok)
        if (parsed is LicenseResult.Invalid) {
          return VerifyResult(VerifyStatus.BAD_LICENSE, licenseError = parsed.reason)
        }
        val lic = (parsed as LicenseResult.Valid).license
        if (ts.isBefore(lic.iat.minus(CLOCK_SKEW))) {
          return VerifyResult(VerifyStatus.BAD_LICENSE, lic.tid, ts, declared, LicenseError.NOT_YET_VALID)
        }
        if (lic.exp != null && ts.isAfter(lic.exp)) {
          return VerifyResult(VerifyStatus.BAD_LICENSE, lic.tid, ts, declared, LicenseError.EXPIRED)
        }

        val actual = sha256(raf, sealBox.start)
        val ok = MessageDigest.isEqual(actual, fromHex(declared))
        return VerifyResult(
          if (ok) VerifyStatus.VALID else VerifyStatus.TAMPERED_CONTENT,
          lic.tid, ts, declared,
        )
      }
    } catch (e: IOException) {
      throw SealException(SealError.IO, "could not read file", e)
    }
  }

  // ---- ISO-BMFF top-level box walk -------------------------------------------------

  private fun walk(raf: RandomAccessFile): List<Box> {
    val len = raf.length()
    val out = ArrayList<Box>()
    val hdr = ByteArray(16)
    var pos = 0L
    while (pos < len) {
      if (out.size >= MAX_BOXES) throw SealException(SealError.MALFORMED_MP4, "too many boxes")
      if (len - pos < 8) {
        if (out.isEmpty()) throw SealException(SealError.NOT_MP4, "too short")
        throw SealException(SealError.MALFORMED_MP4, "truncated box header")
      }
      raf.seek(pos)
      raf.readFully(hdr, 0, 8)
      val type = String(hdr, 4, 4, Charsets.ISO_8859_1)
      if (out.isEmpty() && type != "ftyp") throw SealException(SealError.NOT_MP4, "first box is not ftyp")

      var size = u32(hdr, 0)
      var headerLen = 8
      var toEof = false
      if (size == 1L) {
        if (len - pos < 16) throw SealException(SealError.MALFORMED_MP4, "truncated large-size header")
        raf.readFully(hdr, 8, 8)
        size = u64(hdr, 8)
        headerLen = 16
      } else if (size == 0L) {
        size = len - pos
        toEof = true
      }
      if (size < headerLen || size > len - pos) throw SealException(SealError.MALFORMED_MP4, "bad box size")
      out.add(Box(pos, size, type, headerLen, toEof))
      pos += size
    }
    if (out.isEmpty()) throw SealException(SealError.NOT_MP4, "empty file")
    return out
  }

  private fun isSeal(raf: RandomAccessFile, box: Box): Boolean {
    if (box.type != "free" || box.size - box.headerLen < 12) return false
    val magic = ByteArray(8)
    raf.seek(box.start + box.headerLen)
    raf.readFully(magic)
    return String(magic, Charsets.US_ASCII) == SEAL_MAGIC
  }

  private fun sha256(raf: RandomAccessFile, length: Long): ByteArray {
    val md = MessageDigest.getInstance("SHA-256")
    val buf = ByteArray(64 * 1024)
    raf.seek(0)
    var remaining = length
    while (remaining > 0) {
      val n = raf.read(buf, 0, minOf(buf.size.toLong(), remaining).toInt())
      if (n < 0) throw IOException("unexpected end of file")
      md.update(buf, 0, n)
      remaining -= n
    }
    return md.digest()
  }

  private fun u32(b: ByteArray, o: Int): Long =
    ((b[o].toLong() and 0xff) shl 24) or ((b[o + 1].toLong() and 0xff) shl 16) or
      ((b[o + 2].toLong() and 0xff) shl 8) or (b[o + 3].toLong() and 0xff)

  private fun u64(b: ByteArray, o: Int): Long = (u32(b, o) shl 32) or u32(b, o + 4)

  internal fun toHex(b: ByteArray): String {
    val sb = StringBuilder(b.size * 2)
    for (x in b) sb.append(String.format("%02x", x.toInt() and 0xff))
    return sb.toString()
  }

  private fun fromHex(s: String): ByteArray = ByteArray(s.length / 2) {
    s.substring(it * 2, it * 2 + 2).toInt(16).toByte()
  }
}
