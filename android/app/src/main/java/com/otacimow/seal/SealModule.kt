package com.otacimow.seal

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.time.Instant

/**
 * Bridge for license activation, sealed exports, verification and sharing.
 *
 * Nothing here touches the network. The license public key ships as the asset
 * `license_pub.pem`; the matching private key is never on the device.
 */
class SealModule(private val rc: ReactApplicationContext) : ReactContextBaseJavaModule(rc) {

  override fun getName() = "Seal"

  private val licenseFile get() = File(rc.filesDir, "license.otc")
  private val acceptFile get() = File(rc.filesDir, "terms_accepted.txt")
  private val registryFile get() = File(rc.filesDir, "exports.jsonl")
  private val registryLock = Any()

  /** null when the key asset is missing or unreadable (the app then cannot activate or seal). */
  private val verifier: LicenseVerifier? by lazy {
    try {
      rc.assets.open("license_pub.pem").use { LicenseVerifier.fromPem(String(it.readBytes(), Charsets.UTF_8)) }
    } catch (e: FileNotFoundException) {
      null
    } catch (e: Exception) {
      null // unreadable or invalid key asset: treat as "no key" so the app fails closed
    }
  }

  // ---- license + terms -------------------------------------------------------------

  private fun readText(f: File): String? =
    try { if (f.isFile) f.readText(Charsets.UTF_8).trim().ifEmpty { null } else null } catch (e: IOException) { null }

  private fun writeAtomic(f: File, text: String) {
    val tmp = File(f.parentFile, f.name + ".tmp")
    FileOutputStream(tmp).use { it.write(text.toByteArray(Charsets.UTF_8)); it.fd.sync() }
    if (!tmp.renameTo(f)) {
      tmp.delete()
      throw IOException("could not replace ${f.name}")
    }
  }

  private fun currentLicense(): LicenseResult? {
    val v = verifier ?: return null
    val tok = readText(licenseFile) ?: return null
    return v.check(tok, Instant.now())
  }

  private fun acceptedTerms(tid: String, termsVersion: String): Boolean {
    val text = readText(acceptFile) ?: return false
    val kv = Kv.parse(text.toByteArray(Charsets.UTF_8)) ?: return false
    return kv["tid"] == tid && kv["terms"] == termsVersion
  }

  private fun statusMap(termsVersion: String): WritableMap {
    val m = Arguments.createMap()
    m.putBoolean("accepted", false)
    if (verifier == null) { m.putString("state", "no_key"); return m }
    when (val r = currentLicense()) {
      null -> m.putString("state", "none")
      is LicenseResult.Invalid -> { m.putString("state", "invalid"); m.putString("reason", r.reason.name) }
      is LicenseResult.Valid -> {
        m.putString("state", "valid")
        m.putString("tid", r.license.tid)
        r.license.exp?.let { m.putString("exp", it.toString()) }
        m.putBoolean("accepted", acceptedTerms(r.license.tid, termsVersion))
      }
    }
    return m
  }

  @ReactMethod
  fun licenseStatus(termsVersion: String, promise: Promise) {
    try { promise.resolve(statusMap(termsVersion)) } catch (e: Exception) { promise.reject("status_failed", e.message, e) }
  }

  @ReactMethod
  fun activateLicense(token: String, termsVersion: String, promise: Promise) {
    Thread {
      try {
        val v = verifier ?: return@Thread promise.reject("no_key", "This build has no license key (license_pub.pem).")
        when (val r = v.check(token, Instant.now())) {
          is LicenseResult.Invalid -> promise.reject("license_invalid", r.reason.name)
          is LicenseResult.Valid -> {
            writeAtomic(licenseFile, r.license.token)
            promise.resolve(statusMap(termsVersion))
          }
        }
      } catch (e: Exception) {
        promise.reject("activate_failed", e.message, e)
      }
    }.start()
  }

  @ReactMethod
  fun acceptTerms(termsVersion: String, promise: Promise) {
    Thread {
      try {
        val r = currentLicense()
        if (r !is LicenseResult.Valid) return@Thread promise.reject("not_licensed", "Activate a valid license first.")
        val text = String(
          Kv.build(listOf("tid" to r.license.tid, "terms" to termsVersion, "ts" to Instant.now().toString())),
          Charsets.UTF_8,
        )
        writeAtomic(acceptFile, text)
        promise.resolve(statusMap(termsVersion))
      } catch (e: Exception) {
        promise.reject("accept_failed", e.message, e)
      }
    }.start()
  }

  // ---- sealed export --------------------------------------------------------------

  /**
   * Seals the finished MP4 at [path], verifies the seal, saves the sealed master to
   * Movies/Otacimow and records it. The master is the file to keep and to share.
   */
  @ReactMethod
  fun finalizeExport(path: String, displayName: String, termsVersion: String, promise: Promise) {
    Thread {
      try {
        val v = verifier ?: return@Thread promise.reject("no_key", "This build has no license key (license_pub.pem).")
        val lic = currentLicense()
        if (lic !is LicenseResult.Valid) return@Thread promise.reject("not_licensed", "Activate a valid license to export.")
        if (!acceptedTerms(lic.license.tid, termsVersion)) {
          return@Thread promise.reject("terms_not_accepted", "Accept the license terms to export.")
        }
        if (!NAME_RE.matches(displayName)) return@Thread promise.reject("bad_name", "Invalid export file name.")
        val file = File(path)
        if (!file.isFile || file.length() == 0L) return@Thread promise.reject("no_file", "Export file is missing.")

        val info = try {
          Mp4Seal.seal(file, lic.license, Instant.now())
        } catch (e: SealException) {
          return@Thread promise.reject("seal_failed", e.code.name, e)
        }
        val check = Mp4Seal.verify(file, v)
        if (check.status != VerifyStatus.VALID) {
          return@Thread promise.reject("seal_verify_failed", check.status.name)
        }

        val saved = try {
          saveMaster(file, displayName)
        } catch (e: IOException) {
          return@Thread promise.reject("save_failed", e.message, e)
        }
        appendRegistry(
          JSONObject()
            .put("t", "export").put("ts", info.ts.toString()).put("name", displayName)
            .put("sha256", info.sha256).put("tid", info.tid).put("uri", saved.uri.toString())
        )
        file.delete() // cache copy; the sealed master now lives in Movies/Otacimow

        val m = Arguments.createMap()
        m.putString("sha256", info.sha256)
        m.putString("tid", info.tid)
        m.putString("ts", info.ts.toString())
        m.putString("uri", saved.uri.toString())
        m.putString("location", saved.location)
        promise.resolve(m)
      } catch (e: Exception) {
        promise.reject("export_failed", e.message, e)
      }
    }.start()
  }

  private class Saved(val uri: Uri, val location: String)

  private fun saveMaster(src: File, displayName: String): Saved {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val resolver = rc.contentResolver
      val values = ContentValues().apply {
        put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
        put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
        put(MediaStore.Video.Media.RELATIVE_PATH, "Movies/Otacimow")
        put(MediaStore.Video.Media.IS_PENDING, 1)
      }
      val uri = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
        ?: throw IOException("MediaStore refused the new file")
      try {
        val out = resolver.openOutputStream(uri) ?: throw IOException("could not open MediaStore output")
        out.use { o -> FileInputStream(src).use { it.copyTo(o) } }
        val written = resolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: -1L
        if (written != src.length()) throw IOException("saved file size mismatch")
        val done = ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }
        resolver.update(uri, done, null, null)
      } catch (e: IOException) {
        resolver.delete(uri, null, null)
        throw e
      }
      return Saved(uri, "Movies/Otacimow")
    }
    val dir = rc.getExternalFilesDir(Environment.DIRECTORY_MOVIES) ?: throw IOException("no external storage")
    dir.mkdirs()
    val dest = File(dir, displayName)
    try {
      FileInputStream(src).use { i -> FileOutputStream(dest).use { o -> i.copyTo(o); o.fd.sync() } }
      if (dest.length() != src.length()) throw IOException("saved file size mismatch")
    } catch (e: IOException) {
      dest.delete()
      throw e
    }
    val uri = FileProvider.getUriForFile(rc, rc.packageName + ".fileprovider", dest)
    return Saved(uri, "Android/data/${rc.packageName}/files/Movies")
  }

  // ---- verify ---------------------------------------------------------------------

  @ReactMethod
  fun verifyFile(path: String, promise: Promise) {
    Thread {
      try {
        val v = verifier ?: return@Thread promise.reject("no_key", "This build has no license key (license_pub.pem).")
        val r = Mp4Seal.verify(File(path), v)
        val m = Arguments.createMap()
        m.putString("status", r.status.name)
        r.tid?.let { m.putString("tid", it) }
        r.ts?.let { m.putString("ts", it.toString()) }
        r.sha256?.let { m.putString("sha256", it) }
        r.licenseError?.let { m.putString("licenseError", it.name) }
        promise.resolve(m)
      } catch (e: SealException) {
        promise.reject("verify_failed", e.code.name, e)
      } catch (e: Exception) {
        promise.reject("verify_failed", e.message, e)
      }
    }.start()
  }

  // ---- share ----------------------------------------------------------------------

  /** Opens the target app's share UI with the sealed master attached. The user taps Post. */
  @ReactMethod
  fun shareVideo(uriString: String, packageName: String?, sha256: String?, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = "video/mp4"
        putExtra(Intent.EXTRA_STREAM, uri)
        clipData = ClipData.newRawUri("otacimow", uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val launch = if (packageName.isNullOrEmpty()) Intent.createChooser(send, "Share") else send.setPackage(packageName)
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      rc.startActivity(launch)
      if (sha256 != null && SHA_RE.matches(sha256)) {
        appendRegistry(
          JSONObject().put("t", "share_opened").put("ts", Instant.now().toString())
            .put("sha256", sha256).put("target", packageName ?: "chooser")
        )
      }
      promise.resolve(true)
    } catch (e: ActivityNotFoundException) {
      promise.reject("not_installed", packageName ?: "no app can share video")
    } catch (e: Exception) {
      promise.reject("share_failed", e.message, e)
    }
  }

  // ---- local export registry (never uploaded) ---------------------------------------

  private fun appendRegistry(entry: JSONObject) {
    synchronized(registryLock) {
      try {
        FileOutputStream(registryFile, true).use {
          it.write((entry.toString() + "\n").toByteArray(Charsets.UTF_8))
          it.fd.sync()
        }
      } catch (e: IOException) {
        // The registry is a convenience record; an export must not fail because of it.
      }
    }
  }

  @ReactMethod
  fun recentExports(limit: Int, promise: Promise) {
    Thread {
      try {
        val out = Arguments.createArray()
        val lines = synchronized(registryLock) {
          if (registryFile.isFile) registryFile.readLines(Charsets.UTF_8) else emptyList()
        }
        var n = 0
        for (line in lines.asReversed()) {
          if (n >= limit.coerceIn(1, 100)) break
          val o = try { JSONObject(line) } catch (e: Exception) { continue }
          if (o.optString("t") != "export") continue
          val m = Arguments.createMap()
          m.putString("ts", o.optString("ts"))
          m.putString("name", o.optString("name"))
          m.putString("sha256", o.optString("sha256"))
          m.putString("tid", o.optString("tid"))
          m.putString("uri", o.optString("uri"))
          out.pushMap(m)
          n++
        }
        promise.resolve(out)
      } catch (e: Exception) {
        promise.reject("registry_failed", e.message, e)
      }
    }.start()
  }

  private companion object {
    val NAME_RE = Regex("^[A-Za-z0-9._-]{1,100}\\.mp4$")
    val SHA_RE = Regex("^[0-9a-f]{64}$")
  }
}
