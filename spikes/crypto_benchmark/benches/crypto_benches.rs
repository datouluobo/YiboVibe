use criterion::{black_box, criterion_group, criterion_main, Criterion};
use crypto_prototype::{generate_salt, DataKey, MasterKey};

pub fn criterion_benchmark(c: &mut Criterion) {
    let password = "MySuperSecretPassword123!";
    let user_salt = generate_salt();

    let mut group = c.benchmark_group("MK-DK Architecture");

    // Benchmark MK derivation (Argon2id)
    group.bench_function("mk_derivation", |b| {
        b.iter(|| MasterKey::derive(black_box(password), black_box(&user_salt)).unwrap())
    });

    // Benchmark DK payload encryption
    let mk = MasterKey::derive(password, &user_salt).unwrap();
    let dk = DataKey::generate();
    let payload = "This is a typical snippet text replacement string.";

    group.bench_function("dk_encrypt_payload", |b| {
        b.iter(|| dk.encrypt_payload(black_box(payload)).unwrap())
    });

    group.finish();
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);
