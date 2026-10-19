package com.otacimow.audio

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.Environment
import com.facebook.react.bridge.*
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Zero-telemetry local diagnostics exporter.
 * Collects device specs, audio driver configuration, and this app's recent
 * logcat output (including crash stack traces) into a single zip saved to
 * the device's Downloads folder. NOTHING leaves the device — the tester
 * reviews the archive and sends it manually.
 */
class DiagModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "Diag"

  @ReactMethod
  fun exportDiagnostics(promise: Promise) {
    Thread {
      try {
        val ctx = reactApplicationContext
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val outDir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
          ?: ctx.filesDir
        val zipFile = File(outDir, "soundreel_beta_diag_$stamp.zip")

        ZipOutputStream(FileOutputStream(zipFile)).use { zip ->
          putEntry(zip, "system_specs.txt", systemSpecs())
          putEntry(zip, "audio_config.txt", audioConfig(ctx))
          putEntry(zip, "app_logcat.txt", appLogcat())
          putEntry(zip, "README.txt", readme())
        }

        promise.resolve(zipFile.absolutePath)
      } catch (e: Exception) {
        promise.reject("diag_failed", e.message, e)
      }
    }.start()
  }

  private fun putEntry(zip: ZipOutputStream, name: String, content: String) {
    zip.putNextEntry(ZipEntry(name))
    zip.write(content.toByteArray(Charsets.UTF_8))
    zip.closeEntry()
  }

  private fun systemSpecs(): String = buildString {
    appendLine("SoundReel beta diagnostics — system specs")
    appendLine("timestamp: ${Date()}")
    appendLine("device: ${Build.MANUFACTURER} ${Build.MODEL} (${Build.DEVICE})")
    appendLine("android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})")
    appendLine("abi: ${Build.SUPPORTED_ABIS.joinToString()}")
    appendLine("build: ${Build.DISPLAY}")
    val rt = Runtime.getRuntime()
    appendLine("jvm max heap MB: ${rt.maxMemory() / 1048576}")
    appendLine("cores: ${rt.availableProcessors()}")
  }

  private fun audioConfig(ctx: Context): String = buildString {
    appendLine("SoundReel beta diagnostics — audio configuration")
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    appendLine("native sample rate: ${am.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)}")
    appendLine("native frames/buffer: ${am.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)}")
    appendLine("low-latency audio: ${ctx.packageManager.hasSystemFeature("android.hardware.audio.low_latency")}")
    appendLine("pro audio: ${ctx.packageManager.hasSystemFeature("android.hardware.audio.pro")}")
    appendLine("bluetooth a2dp on: ${am.isBluetoothA2dpOn}")
    appendLine("wired headset on: ${am.isWiredHeadsetOn}")
    appendLine("music volume: ${am.getStreamVolume(AudioManager.STREAM_MUSIC)}/${am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)}")
  }

  /** This app's own recent log output only (-d dump, last ~3000 lines). */
  private fun appLogcat(): String = try {
    val pid = android.os.Process.myPid()
    val proc = Runtime.getRuntime().exec(arrayOf("logcat", "-d", "-t", "3000", "--pid=$pid"))
    BufferedReader(InputStreamReader(proc.inputStream)).readText()
  } catch (e: Exception) {
    "logcat unavailable: ${e.message}"
  }

  private fun readme(): String = """
    SoundReel beta diagnostic archive.
    Generated locally on your device. Nothing in this archive was transmitted
    anywhere — SoundReel performs no telemetry, analytics, or background
    data collection. Review the contents, then send this zip to the SoundReel
    team through whatever channel you prefer.
  """.trimIndent()
}
