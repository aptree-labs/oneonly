use super::*;
fn share(id: u8, bps: u16) -> Share {
    Share {
        x_id_hash: [id; 32],
        bps,
    }
}
#[test]
fn shares_are_fixed_positive_unique_and_complete() {
    assert!(validate_shares(&[share(1, 2500), share(2, 7500)]).is_ok());
    for bad in [
        vec![],
        vec![share(1, 9999)],
        vec![share(1, 5000), share(1, 5000)],
        vec![share(0, 10000)],
        vec![share(1, 0), share(2, 10000)],
        (1..=10).map(|id| share(id, 1000)).collect(),
    ] {
        assert!(validate_shares(&bad).is_err());
    }
}
#[test]
fn cumulative_entitlement_preserves_dust_and_never_overpays() {
    for total in [0, 1, 2, 3, 7, 9999, 10000, 10001, u64::MAX] {
        for shares in [[1, 9999], [2500, 7500], [3333, 6667]] {
            let payouts = shares
                .iter()
                .map(|s| entitlement(total, *s).unwrap() as u128)
                .sum::<u128>();
            assert!(payouts <= total as u128);
            assert!((total as u128) - payouts <= 1);
        }
    }
    let split = 3333;
    let mut claimed = 0;
    let mut paid = 0;
    for deposited in 1..=10000 {
        let cumulative = entitlement(deposited, split).unwrap();
        paid += cumulative - claimed;
        claimed = cumulative;
    }
    assert_eq!(paid, 3333);
}
fn args() -> ClaimArgs {
    ClaimArgs {
        x_id_hash: [4; 32],
        cumulative_limit: 50,
        binding_version: 1,
        nonce: [7; 32],
        issued_at: 1000,
        expires_at: 1300,
    }
}
fn ed_data(verifier: &Pubkey, message: &[u8]) -> Vec<u8> {
    let mut data = vec![1, 0];
    for value in [48u16, 65535, 16, 65535, 112, message.len() as u16, 65535] {
        data.extend(value.to_le_bytes());
    }
    data.extend(verifier.to_bytes());
    data.extend([0; 64]);
    data.extend(message);
    data
}
#[test]
fn attestation_has_exact_domain_and_integer_layout() {
    let args = args();
    let key = Pubkey::new_from_array([9; 32]);
    let message = claim_message(&crate::ID, &key, &key, &key, &key, &args);
    assert!(message.starts_with(b"oneonly:fee-claim:v1:devnet"));
    assert_eq!(message.len(), DOMAIN.len() + 32 * 7 + 8 * 4);
    let start = DOMAIN.len() + 32 * 6;
    assert_eq!(&message[start..start + 8], &50u64.to_le_bytes());
    assert_eq!(&message[message.len() - 8..], &1300i64.to_le_bytes());
}
#[test]
fn parser_rejects_cross_instruction_and_altered_scope() {
    let verifier = Pubkey::new_unique();
    let key = Pubkey::new_unique();
    let message = claim_message(&crate::ID, &key, &key, &key, &key, &args());
    let original = ed_data(&verifier, &message);
    assert!(verify_ed25519_instruction(&original, &verifier, &message).is_ok());
    for index in [0, 1, 4, 8, 14, 16, 112, original.len() - 1] {
        let mut altered = original.clone();
        altered[index] ^= 1;
        assert!(
            verify_ed25519_instruction(&altered, &verifier, &message).is_err(),
            "offset {index}"
        );
    }
    assert!(verify_ed25519_instruction(&original, &Pubkey::new_unique(), &message).is_err());
    assert!(verify_ed25519_instruction(&original[..15], &verifier, &message).is_err());
    let mut changed = args();
    changed.cumulative_limit += 1;
    let other = claim_message(&crate::ID, &key, &key, &key, &key, &changed);
    assert!(verify_ed25519_instruction(&original, &verifier, &other).is_err());
}
#[test]
fn pool_keys_fail_closed_on_truncation() {
    assert!(read_key(&[0; 31], 0).is_err());
    assert_eq!(
        read_key(&[6; 64], 32).unwrap(),
        Pubkey::new_from_array([6; 32])
    );
}
