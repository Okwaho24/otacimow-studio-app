package com.otacimow.audio

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.otacimow.seal.SealModule

class OtacimowPackage : ReactPackage {
  override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> =
    listOf(
      AudioEngineModule(ctx),
      WaveformLockModule(ctx),
      DiagModule(ctx),
      SealModule(ctx),
    )

  override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
