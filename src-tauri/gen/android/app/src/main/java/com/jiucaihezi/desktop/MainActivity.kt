package com.jiucaihezi.desktop

import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.enableEdgeToEdge
import java.nio.ByteBuffer
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    appContext = applicationContext
  }

  companion object {
    private const val STORE_NAME = "jiucaihezi_secure_credentials"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val KEY_PREFIX = "jiucaihezi."
    private var appContext: android.content.Context? = null

    private fun key(alias: String): java.security.Key {
      val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
      val name = KEY_PREFIX + alias
      if (!store.containsAlias(name)) {
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
          KeyGenParameterSpec.Builder(
            name,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
          )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build(),
        )
        generator.generateKey()
      }
      return store.getKey(name, null)
    }

    @JvmStatic
    fun secureRead(alias: String): String? {
      val context = appContext ?: return null
      val encoded = context.getSharedPreferences(STORE_NAME, android.content.Context.MODE_PRIVATE)
        .getString(alias, null) ?: return null
      return try {
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        val buffer = ByteBuffer.wrap(bytes)
        val iv = ByteArray(buffer.getInt())
        buffer.get(iv)
        val ciphertext = ByteArray(buffer.remaining())
        buffer.get(ciphertext)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(alias), GCMParameterSpec(128, iv))
        String(cipher.doFinal(ciphertext), Charsets.UTF_8)
      } catch (_: Exception) {
        null
      }
    }

    @JvmStatic
    fun secureWrite(alias: String, value: String) {
      val context = appContext ?: return
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key(alias))
      val ciphertext = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
      val iv = cipher.iv
      val bytes = ByteBuffer.allocate(4 + iv.size + ciphertext.size)
        .putInt(iv.size)
        .put(iv)
        .put(ciphertext)
        .array()
      context.getSharedPreferences(STORE_NAME, android.content.Context.MODE_PRIVATE)
        .edit()
        .putString(alias, Base64.encodeToString(bytes, Base64.NO_WRAP))
        .apply()
    }

    @JvmStatic
    fun secureClear(alias: String) {
      val context = appContext ?: return
      context.getSharedPreferences(STORE_NAME, android.content.Context.MODE_PRIVATE)
        .edit()
        .remove(alias)
        .apply()
      val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
      val name = KEY_PREFIX + alias
      if (store.containsAlias(name)) store.deleteEntry(name)
    }
  }
}
