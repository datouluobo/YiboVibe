use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng, SaltString},
    Argon2,
};
use rand::RngCore;

/// Derive a 256-bit AES-GCM key from the user's master password utilizing Argon2id
pub fn derive_vault_key(password: &str, salt_str: &str) -> Result<[u8; 32], String> {
    let salt = SaltString::from_b64(salt_str)
        .map_err(|e| format!("Invalid base64 salt: {}", e))?;

    // We use robust Argon2id settings
    let argon2 = Argon2::default();
    
    let mut key_buffer = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), salt.as_str().as_bytes(), &mut key_buffer)
        .map_err(|e| format!("Key derivation failed: {}", e))?;

    Ok(key_buffer)
}

/// Helper function to generate a new cryptographically secure 12-byte Nonce
pub fn generate_nonce() -> [u8; 12] {
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    nonce_bytes
}

/// Encrypt arbitrary bytes into a sealed container [NONCE(12) | CIPHERTEXT | TAG(16)]
pub fn encrypt_payload(data: &[u8], key: &[u8; 32], associated_data: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce_bytes = generate_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);

    // AEAD payload includes AAD (Associated Data) to prevent swapping containers
    let payload = Payload {
        msg: data,
        aad: associated_data,
    };

    let ciphertext = cipher
        .encrypt(nonce, payload)
        .map_err(|e| format!("AES-GCM encryption failed: {}", e))?;

    // Prepend the 12-byte nonce to the final byte stream
    let mut final_enc = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
    final_enc.extend_from_slice(&nonce_bytes);
    final_enc.extend_from_slice(&ciphertext);

    Ok(final_enc)
}

/// Decrypt a sealed container, assuming it follows the format [NONCE(12) | CIPHERTEXT | TAG(16)]
pub fn decrypt_payload(sealed_data: &[u8], key: &[u8; 32], associated_data: &[u8]) -> Result<Vec<u8>, String> {
    if sealed_data.len() < 12 {
        return Err("Payload too small to contain a nonce".into());
    }

    let cipher = Aes256Gcm::new(key.into());
    let (nonce_bytes, ciphertext) = sealed_data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let payload = Payload {
        msg: ciphertext,
        aad: associated_data,
    };

    cipher
        .decrypt(nonce, payload)
        .map_err(|_e| "AES-GCM decryption failed/Authentication tag mismatch. Incorrect password or data corrupted.".into())
}
