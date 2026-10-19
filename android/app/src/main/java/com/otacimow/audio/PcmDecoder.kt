package com.otacimow.audio

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Decodes any audio (or the audio track of a video) to mono Float PCM at a
 * reduced analysis rate, using MediaExtractor + MediaCodec. Used by both
 * WaveformLock (sync analysis) and scratchPeak (normalize).
 */
object PcmDecoder {

  fun decodeMono(path: String, maxSeconds: Double, targetRate: Int): FloatArray {
    val extractor = MediaExtractor()
    extractor.setDataSource(path)

    var trackIndex = -1
    var format: MediaFormat? = null
    for (i in 0 until extractor.trackCount) {
      val f = extractor.getTrackFormat(i)
      if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) {
        trackIndex = i; format = f; break
      }
    }
    require(trackIndex >= 0 && format != null) { "no audio track in $path" }

    extractor.selectTrack(trackIndex)
    val mime = format.getString(MediaFormat.KEY_MIME)!!
    val srcRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    val channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

    val codec = MediaCodec.createDecoderByType(mime)
    codec.configure(format, null, null, 0)
    codec.start()

    val maxOutSamples = (maxSeconds * targetRate).toInt()
    val out = FloatArray(maxOutSamples)
    var outCount = 0

    val ratio = srcRate.toDouble() / targetRate
    var srcMonoIndex = 0L        // running index of mono samples consumed
    var acc = 0.0
    var accN = 0
    var nextBoundary = ratio     // next downsample block boundary in mono samples

    val info = MediaCodec.BufferInfo()
    var inputDone = false
    var outputDone = false

    while (!outputDone && outCount < maxOutSamples) {
      if (!inputDone) {
        val inIdx = codec.dequeueInputBuffer(10_000)
        if (inIdx >= 0) {
          val buf = codec.getInputBuffer(inIdx)!!
          val size = extractor.readSampleData(buf, 0)
          if (size < 0) {
            codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
            extractor.advance()
          }
        }
      }

      val outIdx = codec.dequeueOutputBuffer(info, 10_000)
      if (outIdx >= 0) {
        val buf = codec.getOutputBuffer(outIdx)!!
        buf.order(ByteOrder.LITTLE_ENDIAN)
        val shorts = buf.asShortBuffer()
        val frameCount = shorts.remaining() / channels

        for (f in 0 until frameCount) {
          // mix to mono
          var s = 0f
          for (c in 0 until channels) s += shorts.get(f * channels + c) / 32768f
          s /= channels

          acc += s; accN++
          srcMonoIndex++
          if (srcMonoIndex >= nextBoundary) {
            if (outCount < maxOutSamples && accN > 0) {
              out[outCount++] = (acc / accN).toFloat()
            }
            acc = 0.0; accN = 0
            nextBoundary += ratio
          }
          if (outCount >= maxOutSamples) break
        }

        codec.releaseOutputBuffer(outIdx, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
      }
    }

    codec.stop(); codec.release(); extractor.release()
    return out.copyOf(outCount)
  }
}
