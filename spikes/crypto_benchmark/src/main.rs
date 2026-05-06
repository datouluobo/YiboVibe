use crypto_prototype::{generate_salt, DataKey, MasterKey};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("--- Step 1: User Registration ---");
    let password = "MySuperSecretPassword123!";
    let user_salt = generate_salt();
    println!("Generated kdf_salt (stored in DB): {}", user_salt);

    println!("\n--- Step 2: Client derives Master Key (MK) ---");
    let mk = MasterKey::derive(password, &user_salt)?;
    println!("MK derived successfully (never stored on disk/NAS).");

    println!("\n--- Step 3: Copying text -> Encrypting with Data Key (DK) ---");
    let plaintext = "Important private clipboard text: Pssst!";

    // 1. Generate DK
    let dk = DataKey::generate();

    // 2. Encrypt actual clipboard data with DK
    let encrypted_payload = dk.encrypt_payload(plaintext)?;
    println!(
        "Encrypted clipboard payload: {:?}",
        val_preview(&encrypted_payload.ciphertext)
    );

    // 3. Wrap DK with MK
    let wrapped_dk = mk.wrap_dk(&dk)?;
    println!(
        "Wrapped DK: {:?}",
        val_preview(&wrapped_dk.encrypted_dk.ciphertext)
    );

    println!("\n--- Step 4: Receiving encrypted data -> Decrypting ---");
    // Client B pulls encrypted_payload and wrapped_dk from NAS
    // Client B uses its own derived MK to unwrap the DK
    let new_mk = MasterKey::derive(password, &user_salt)?;
    let unwrapped_dk = new_mk.unwrap_dk(&wrapped_dk)?;
    println!("DK unwrapped successfully.");

    let decrypted_text = unwrapped_dk.decrypt_payload(&encrypted_payload)?;
    println!("Decrypted clipboard text: '{}'", decrypted_text);

    assert_eq!(plaintext, decrypted_text);
    println!("\nSUCCESS: E2EE MK/DK workflow validated.");

    Ok(())
}

fn val_preview(s: &str) -> String {
    if s.len() > 10 {
        format!("{}...", &s[..10])
    } else {
        s.to_string()
    }
}
