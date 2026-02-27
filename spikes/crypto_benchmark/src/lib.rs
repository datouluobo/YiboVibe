use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::{
    password_hash::{rand_core::RngCore, PasswordHasher, SaltString},
    Argon2, Params,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum CryptoError {
    #[error("Argon2 error: {0}")]
    Argon2(String),
    #[error("AES-GCM error: {0}")]
    AesGcm(String),
    #[error("Base64 error: {0}")]
    Base64(String),
    #[error("Invalid padding or data")]
    InvalidData,
}

impl From<argon2::password_hash::Error> for CryptoError {
    fn from(e: argon2::password_hash::Error) -> Self {
        CryptoError::Argon2(e.to_string())
    }
}

impl From<aes_gcm::Error> for CryptoError {
    fn from(e: aes_gcm::Error) -> Self {
        CryptoError::AesGcm(e.to_string())
    }
}

impl From<base64::DecodeError> for CryptoError {
    fn from(e: base64::DecodeError) -> Self {
        CryptoError::Base64(e.to_string())
    }
}

/// The Master Key (MK) derived from user's password.
/// Stored only in memory on the client.
pub struct MasterKey {
    key: Key<Aes256Gcm>,
}

/// Represents an encrypted payload along with its nonce.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EncryptedData {
    pub ciphertext: String, // Base64 encoded
    pub nonce: String,      // Base64 encoded
}

/// Represents the Data Key (DK) wrapped by the Master Key.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WrappedDataKey {
    pub encrypted_dk: EncryptedData,
}

impl MasterKey {
    /// Derive a Master Key from a password and generic salt.
    pub fn derive(password: &str, salt_b64: &str) -> Result<Self, CryptoError> {
        let salt = SaltString::from_b64(salt_b64)
            .map_err(|_| CryptoError::InvalidData)?;
        
        let argon2 = Argon2::new(
            argon2::Algorithm::Argon2id,
            argon2::Version::V0x13,
            Params::new(65536, 3, 4, None).unwrap(), // 64MB, 3 iterations, 4 parallelism
        );

        let mut key_bytes = [0u8; 32];
        argon2.hash_password_into(password.as_bytes(), salt.as_str().as_bytes(), &mut key_bytes)
            .map_err(|e| CryptoError::Argon2(e.to_string()))?;

        Ok(Self {
            key: *Key::<Aes256Gcm>::from_slice(&key_bytes),
        })
    }

    /// Wrap (encrypt) a freshly generated Data Key with the Master Key.
    pub fn wrap_dk(&self, dk: &DataKey) -> Result<WrappedDataKey, CryptoError> {
        let cipher = Aes256Gcm::new(&self.key);
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng); 
        let ciphertext = cipher.encrypt(&nonce, dk.key.as_slice())?;

        Ok(WrappedDataKey {
            encrypted_dk: EncryptedData {
                ciphertext: STANDARD.encode(ciphertext),
                nonce: STANDARD.encode(nonce),
            },
        })
    }

    /// Unwrap (decrypt) a Data Key using the Master Key.
    pub fn unwrap_dk(&self, wrapped_dk: &WrappedDataKey) -> Result<DataKey, CryptoError> {
        let cipher = Aes256Gcm::new(&self.key);
        let nonce_bytes = STANDARD.decode(&wrapped_dk.encrypted_dk.nonce)?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext_bytes = STANDARD.decode(&wrapped_dk.encrypted_dk.ciphertext)?;

        let dk_bytes = cipher.decrypt(nonce, ciphertext_bytes.as_ref())?;

        Ok(DataKey {
            key: *Key::<Aes256Gcm>::from_slice(&dk_bytes),
        })
    }
}

/// The Data Key (DK) used to encrypt actual data (clipboard, snippets).
pub struct DataKey {
    key: Key<Aes256Gcm>,
}

impl DataKey {
    /// Generate a fresh random Data Key.
    pub fn generate() -> Self {
        let mut key_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut key_bytes);
        Self {
            key: *Key::<Aes256Gcm>::from_slice(&key_bytes),
        }
    }

    /// Encrypt a payload text (e.g. clipboard text) using the Data Key.
    pub fn encrypt_payload(&self, plaintext: &str) -> Result<EncryptedData, CryptoError> {
        let cipher = Aes256Gcm::new(&self.key);
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng); 
        let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes())?;

        Ok(EncryptedData {
            ciphertext: STANDARD.encode(ciphertext),
            nonce: STANDARD.encode(nonce),
        })
    }

    /// Decrypt a payload text using the Data Key.
    pub fn decrypt_payload(&self, encrypted_data: &EncryptedData) -> Result<String, CryptoError> {
        let cipher = Aes256Gcm::new(&self.key);
        let nonce_bytes = STANDARD.decode(&encrypted_data.nonce)?;
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext_bytes = STANDARD.decode(&encrypted_data.ciphertext)?;

        let decrypted_bytes = cipher.decrypt(nonce, ciphertext_bytes.as_ref())?;
        String::from_utf8(decrypted_bytes).map_err(|_| CryptoError::InvalidData)
    }
}

pub fn generate_salt() -> String {
    let salt = SaltString::generate(&mut OsRng);
    salt.as_str().to_string()
}
