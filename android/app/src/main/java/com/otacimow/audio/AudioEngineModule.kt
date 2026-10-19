package com.otacimow.audio

import android.media.MediaPlayer
import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.PresetReverb
import com.facebook.react.bridge.*
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * SoundReel native audio engine — Android (API 28+).
 *
 * Live preview chain (per active player's audio session):
 *   MediaPlayer -> DynamicsProcessing (3-band pre-EQ + single-band compressor + input/post gain)
 *               -> PresetReverb (aux send)
 *
 * Mirrors the validated web-prototype parameter model. Offline export is done
 * through the FFmpeg filter chain (export/ffmpeg-android.md) for deterministic
 * results — live effects here are for real-time preview.
 *
 * Sync model: video plays MUTED in the RN view; this engine owns audio.
 * studioTime = videoTime + syncOffsetSec.
 */
class AudioEngineModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "AudioEngine"

  private var scratchPlayer: MediaPlayer? = null
  private var studioPlayer: MediaPlayer? = null
  private var dynamics: DynamicsProcessing? = null
  private var reverb: PresetReverb? = null

  private var activeSource = "scratch" // "scratch" | "studio"
  private var syncOffsetSec = 0.0
  private var bypass = false

  // Current parameter state (applied on rebuild + live)
  private var eqLow = 0.0
  private var eqMid = 0.0
  private var eqHigh = 0.0
  private var eqMidFreq = 1000.0
  private var compThreshold = 0.0
  private var compRatio = 1.0
  private var compAttackMs = 10.0
  private var compReleaseMs = 250.0
  private var compMakeup = 0.0
  private var gainDb = 0.0
  private var reverbPresetName = "off"
  private var reverbMixPercent = 0.0

  // ---------------- Loading ----------------

  @ReactMethod
  fun loadScratch(path: String, promise: Promise) {
    try {
      scratchPlayer?.release()
      scratchPlayer = MediaPlayer().apply {
        setDataSource(path)
        prepare()
      }
      if (activeSource == "scratch") attachEffects(scratchPlayer!!)
      promise.resolve(Arguments.createMap().apply {
        putDouble("durationSec", (scratchPlayer!!.duration) / 1000.0)
      })
    } catch (e: Exception) {
      promise.reject("load_scratch_failed", e.message, e)
    }
  }

  @ReactMethod
  fun loadStudio(path: String, promise: Promise) {
    try {
      studioPlayer?.release()
      studioPlayer = MediaPlayer().apply {
        setDataSource(path)
        prepare()
      }
      if (activeSource == "studio") attachEffects(studioPlayer!!)
      promise.resolve(Arguments.createMap().apply {
        putDouble("durationSec", (studioPlayer!!.duration) / 1000.0)
      })
    } catch (e: Exception) {
      promise.reject("load_studio_failed", e.message, e)
    }
  }

  // ---------------- Effects ----------------

  private fun attachEffects(player: MediaPlayer) {
    releaseEffects()
    val session = player.audioSessionId

    // DynamicsProcessing: 3-band pre-EQ + 1-band MBC (compressor) + post gain
    val config = DynamicsProcessing.Config.Builder(
      DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
      2,      // channels (stereo)
      true, 3,  // preEq enabled, 3 bands
      true, 1,  // mbc enabled, 1 band
      false, 0, // postEq disabled
      true      // limiter enabled
    ).build()

    dynamics = DynamicsProcessing(0, session, config).also { dp ->
      applyEqTo(dp)
      applyCompTo(dp)
      applyGainTo(dp)
      dp.enabled = !bypass
    }

    // Reverb as an aux effect on the session
    reverb = PresetReverb(0, session).also { rv ->
      applyReverbTo(rv, player)
      rv.enabled = !bypass && reverbPresetName != "off"
    }
  }

  private fun applyEqTo(dp: DynamicsProcessing) {
    for (ch in 0 until 2) {
      val low = DynamicsProcessing.EqBand(true, 20f, eqLow.toFloat())
      val mid = DynamicsProcessing.EqBand(true, 120f, eqMid.toFloat())
      val high = DynamicsProcessing.EqBand(true, eqMidFreq.toFloat() * 2f, eqHigh.toFloat())
      // Band cutoffs define ranges: [20..120]=low shelf region,
      // [120..midFreq*2]=mid region centered near midFreq, [midFreq*2..nyquist]=high
      dp.setPreEqBandAllChannelsTo(0, low)
      dp.setPreEqBandAllChannelsTo(1, mid)
      dp.setPreEqBandAllChannelsTo(2, high)
    }
  }

  private fun applyCompTo(dp: DynamicsProcessing) {
    val band = DynamicsProcessing.MbcBand(
      true,                       // enabled
      20000f,                     // cutoff (single full-range band)
      compAttackMs.toFloat(),
      compReleaseMs.toFloat(),
      compRatio.toFloat(),
      compThreshold.toFloat(),
      1f,                         // knee width dB
      0f,                         // noise gate threshold (off)
      0f,                         // expander ratio (off)
      0f,                         // pre gain
      compMakeup.toFloat()        // post gain (makeup)
    )
    dp.setMbcBandAllChannelsTo(0, band)
  }

  private fun applyGainTo(dp: DynamicsProcessing) {
    dp.setInputGainAllChannelsTo(gainDb.toFloat())
  }

  private fun applyReverbTo(rv: PresetReverb, player: MediaPlayer) {
    rv.preset = when (reverbPresetName) {
      "room" -> PresetReverb.PRESET_SMALLROOM
      "hall" -> PresetReverb.PRESET_LARGEHALL
      "plate" -> PresetReverb.PRESET_PLATE
      else -> PresetReverb.PRESET_NONE
    }
    player.attachAuxEffect(rv.id)
    val level = (reverbMixPercent / 100.0).coerceIn(0.0, 1.0).toFloat()
    player.setAuxEffectSendLevel(level)
  }

  private fun releaseEffects() {
    dynamics?.release(); dynamics = null
    reverb?.release(); reverb = null
  }

  // ---------------- Transport ----------------

  @ReactMethod
  fun playAt(videoTimeSec: Double, promise: Promise) {
    try {
      stopInternal()
      val player = if (activeSource == "studio") studioPlayer else scratchPlayer
        ?: run { promise.reject("not_loaded", "no media loaded"); return }
      val posSec = if (activeSource == "studio") videoTimeSec + syncOffsetSec else videoTimeSec
      attachEffects(player!!)
      if (posSec >= 0) {
        player.seekTo((posSec * 1000).toInt())
        player.start()
      } else {
        // Studio starts |posSec| after video start
        player.seekTo(0)
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
          { try { player.start() } catch (_: Exception) {} },
          (-posSec * 1000).toLong()
        )
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("play_failed", e.message, e)
    }
  }

  @ReactMethod
  fun stop() = stopInternal()

  private fun stopInternal() {
    try { scratchPlayer?.takeIf { it.isPlaying }?.pause() } catch (_: Exception) {}
    try { studioPlayer?.takeIf { it.isPlaying }?.pause() } catch (_: Exception) {}
  }

  // ---------------- Live parameters ----------------

  @ReactMethod
  fun setEQ(low: Double, mid: Double, high: Double, midFreq: Double) {
    eqLow = low; eqMid = mid; eqHigh = high; eqMidFreq = midFreq
    dynamics?.let { applyEqTo(it) }
  }

  @ReactMethod
  fun setCompressor(threshold: Double, ratio: Double, attackSec: Double,
                    releaseSec: Double, makeup: Double) {
    compThreshold = threshold; compRatio = ratio
    compAttackMs = attackSec * 1000; compReleaseMs = releaseSec * 1000
    compMakeup = makeup
    dynamics?.let { applyCompTo(it) }
  }

  @ReactMethod
  fun setReverb(preset: String, mixPercent: Double) {
    reverbPresetName = preset.lowercase()
    reverbMixPercent = mixPercent
    val player = if (activeSource == "studio") studioPlayer else scratchPlayer
    reverb?.let { rv -> player?.let { applyReverbTo(rv, it) }
      rv.enabled = !bypass && reverbPresetName != "off" }
  }

  @ReactMethod
  fun setGainDb(db: Double) {
    gainDb = db
    dynamics?.let { applyGainTo(it) }
  }

  @ReactMethod
  fun setBypass(on: Boolean) {
    bypass = on
    dynamics?.enabled = !on
    reverb?.enabled = !on && reverbPresetName != "off"
  }

  @ReactMethod
  fun setActiveSource(source: String) {
    activeSource = source
    val player = if (source == "studio") studioPlayer else scratchPlayer
    player?.let { attachEffects(it) }
  }

  @ReactMethod
  fun setSyncOffset(seconds: Double) { syncOffsetSec = seconds }

  // ---------------- Peak (for normalize) ----------------

  /** Decodes the scratch file's PCM and returns peak 0..1 (first up-to-90s). */
  @ReactMethod
  fun scratchPeak(path: String, promise: Promise) {
    Thread {
      try {
        val pcm = PcmDecoder.decodeMono(path, maxSeconds = 90.0, targetRate = 8000)
        var peak = 0f
        for (v in pcm) peak = max(peak, abs(v))
        promise.resolve(peak.toDouble())
      } catch (e: Exception) {
        promise.reject("peak_failed", e.message, e)
      }
    }.start()
  }

  override fun onCatalystInstanceDestroy() {
    stopInternal()
    releaseEffects()
    scratchPlayer?.release(); studioPlayer?.release()
  }
}
