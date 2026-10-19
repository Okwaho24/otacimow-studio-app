package com.otacimow.audio

import com.facebook.react.bridge.*
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Acoustic Waveform Lock — Android.
 *
 * v2 CHANGE: the coarse envelope pass now keeps the top 8 well-separated
 * candidates and scores each with NORMALIZED raw-signal correlation, instead
 * of taking a single argmax.
 *
 * Why: a steady groove's amplitude envelope repeats every beat, so
 * beat-multiple lags score nearly as high as the true offset. Single-argmax
 * selection locks a whole bar off and still reports high confidence — this was
 * caught failing on rhythmic test material in the Rust port. Raw correlation is
 * phase-sensitive and separates them. Most SoundReel content is metronomic, so
 * this is the difference between the signature feature working and quietly lying.
 *
 * Returns offsetSec such that: studioTime = videoTime + offsetSec.
 */
class WaveformLockModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "WaveformLock"

  private val syncRate = 4000
  private val hop = 80
  private val maxAnalyzeSec = 90.0
  private val maxCandidates = 8
  private val separationHops = 12

  @ReactMethod
  fun computeOffset(scratchPath: String, studioPath: String, promise: Promise) {
    Thread {
      try {
        val a = PcmDecoder.decodeMono(scratchPath, maxAnalyzeSec, syncRate)
        val b = PcmDecoder.decodeMono(studioPath, maxAnalyzeSec, syncRate)
        if (a.isEmpty() || b.isEmpty()) {
          promise.reject("sync_failed", "could not decode audio"); return@Thread
        }
        val eA = envelope(a)
        val eB = envelope(b)
        val cands = coarseCandidates(eA, eB)
        if (cands.isEmpty()) {
          promise.reject("sync_failed", "not enough overlapping audio"); return@Thread
        }

        val best = cands[0].second
        val second = if (cands.size > 1) cands[1].second else 0.0
        val (refLag, refScore) = refine(a, b, cands.map { it.first })

        val coarseConf = when {
          second > 0 && best > 0 -> best / second
          best > 0.1 -> 2.0
          else -> 1.0
        }
        val confidence = when {
          refScore > 0.35 -> max(coarseConf, 1.5)
          refScore > 0.15 -> coarseConf
          else -> min(coarseConf, 1.1)
        }

        promise.resolve(Arguments.createMap().apply {
          putDouble("offsetSec", refLag.toDouble() / syncRate)
          putDouble("confidence", confidence)
          putDouble("correlation", refScore)
        })
      } catch (e: Exception) {
        promise.reject("sync_failed", e.message, e)
      }
    }.start()
  }

  private fun envelope(sig: FloatArray): FloatArray {
    val n = sig.size / hop
    if (n <= 0) return FloatArray(0)
    val env = FloatArray(n)
    for (i in 0 until n) {
      var s = 0.0
      val base = i * hop
      for (j in 0 until hop) { val v = sig[base + j].toDouble(); s += v * v }
      env[i] = sqrt(s / hop).toFloat()
    }
    var mean = 0.0
    for (v in env) mean += v
    mean /= n
    for (i in env.indices) env[i] = (env[i] - mean).toFloat()
    return env
  }

  private fun coarseCandidates(eA: FloatArray, eB: FloatArray): List<Pair<Int, Double>> {
    val minOverlap = max(1, min(150, min(eA.size, eB.size) / 2))
    val pA = DoubleArray(eA.size + 1)
    val pB = DoubleArray(eB.size + 1)
    for (i in eA.indices) pA[i + 1] = pA[i] + eA[i].toDouble() * eA[i]
    for (i in eB.indices) pB[i + 1] = pB[i] + eB[i].toDouble() * eB[i]

    val cands = ArrayList<Pair<Int, Double>>(maxCandidates + 1)
    for (k in -(eB.size - minOverlap)..(eA.size - minOverlap)) {
      val iStart = max(0, -k)
      val iEnd = min(eA.size, eB.size - k)
      if (iEnd - iStart < minOverlap) continue

      var dot = 0.0
      for (i in iStart until iEnd) dot += eA[i].toDouble() * eB[i + k]
      val ea = pA[iEnd] - pA[iStart]
      val eb = pB[iEnd + k] - pB[iStart + k]
      val denom = sqrt(ea * eb)
      val score = if (denom > 1e-12) dot / denom else 0.0

      val near = cands.indexOfFirst { abs(it.first - k) <= separationHops }
      if (near >= 0) {
        if (score > cands[near].second) cands[near] = Pair(k, score)
      } else {
        cands.add(Pair(k, score))
        cands.sortByDescending { it.second }
        while (cands.size > maxCandidates) cands.removeAt(cands.size - 1)
      }
    }
    cands.sortByDescending { it.second }
    return cands
  }

  private fun refine(a: FloatArray, b: FloatArray, centers: List<Int>): Pair<Int, Double> {
    val segLen = min(20 * syncRate, a.size)
    val win = 2 * hop
    var bestLag = (centers.firstOrNull() ?: 0) * hop
    var bestScore = Double.NEGATIVE_INFINITY

    for (k in centers) {
      val center = k * hop
      var segStart = max(0, -(center + win))
      segStart = min(segStart, max(0, a.size - segLen))
      val segEnd = min(a.size, segStart + segLen)

      for (lag in (center - win)..(center + win)) {
        var dot = 0.0; var ea = 0.0; var eb = 0.0; var cnt = 0
        for (i in segStart until segEnd) {
          val j = i + lag
          if (j < 0 || j >= b.size) continue
          val x = a[i].toDouble(); val y = b[j].toDouble()
          dot += x * y; ea += x * x; eb += y * y; cnt++
        }
        if (cnt < syncRate) continue
        val denom = sqrt(ea * eb)
        if (denom < 1e-12) continue
        val score = dot / denom
        if (score > bestScore) { bestScore = score; bestLag = lag }
      }
    }
    return Pair(bestLag, if (bestScore == Double.NEGATIVE_INFINITY) 0.0 else bestScore)
  }

  /**
   * Low-rate peak data for the waveform display.
   * (Closes the M3 gap — the editor previously had no sample data to draw.)
   */
  @ReactMethod
  fun waveformPeaks(path: String, buckets: Int, promise: Promise) {
    Thread {
      try {
        val pcm = PcmDecoder.decodeMono(path, maxAnalyzeSec, syncRate)
        val n = max(1, buckets)
        val step = max(1, pcm.size / n)
        val out = Arguments.createArray()
        for (i in 0 until n) {
          val start = i * step
          if (start >= pcm.size) { out.pushDouble(0.0); continue }
          val end = min(pcm.size, start + step)
          var peak = 0f
          for (j in start until end) peak = max(peak, abs(pcm[j]))
          out.pushDouble(peak.toDouble())
        }
        promise.resolve(out)
      } catch (e: Exception) {
        promise.reject("waveform_failed", e.message, e)
      }
    }.start()
  }
}
