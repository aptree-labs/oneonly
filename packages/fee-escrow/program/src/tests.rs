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
        verifier_epoch: 1,
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
    assert!(message.starts_with(b"oneonly:fee:v2:devnet"));
    assert_eq!(message.len(), DOMAIN.len() + 32 * 7 + 8 * 5);
    let start = DOMAIN.len() + 32 * 6;
    assert_eq!(&message[start..start + 8], &50u64.to_le_bytes());
    assert_eq!(
        &message[message.len() - 16..message.len() - 8],
        &1300i64.to_le_bytes()
    );
    assert_eq!(&message[message.len() - 8..], &1u64.to_le_bytes());
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

fn verifier(seed: u8) -> Pubkey {
    (seed..=255)
        .map(|n| Pubkey::new_from_array([n; 32]))
        .find(|key| *key != Pubkey::default() && key.is_on_curve())
        .unwrap()
}
#[test]
fn verifier_rotation_revokes_old_signatures_even_after_key_reuse() {
    let a = verifier(1);
    let b = verifier(100);
    assert_ne!(a, b);
    let mut config = Config {
        verifier: a,
        bump: 1,
    };
    let mut control = Control {
        bump: 2,
        paused: false,
        verifier_epoch: 1,
    };
    let key = Pubkey::new_unique();
    let original = args();
    let old_message = claim_message(&crate::ID, &key, &key, &key, &key, &original);
    let old_signature = ed_data(&a, &old_message);
    assert!(require_claim_control(&control, 1).is_ok());
    rotate_config(&mut config, &mut control, b).unwrap();
    assert_eq!(control.verifier_epoch, 2);
    assert!(verify_ed25519_instruction(&old_signature, &config.verifier, &old_message).is_err());
    rotate_config(&mut config, &mut control, a).unwrap();
    assert_eq!(control.verifier_epoch, 3);
    assert!(require_claim_control(&control, original.verifier_epoch).is_err());
    let mut current = original.clone();
    current.verifier_epoch = 3;
    let new_message = claim_message(&crate::ID, &key, &key, &key, &key, &current);
    assert!(verify_ed25519_instruction(&old_signature, &config.verifier, &new_message).is_err());
    assert!(require_claim_control(&control, current.verifier_epoch).is_ok());
    // Reusing the same key also revokes every previous authorization.
    rotate_config(&mut config, &mut control, a).unwrap();
    assert_eq!(control.verifier_epoch, 4);
    assert!(require_claim_control(&control, 3).is_err());
}
#[test]
fn pause_blocks_allocation_and_claim_guards_and_rotation_does_not_unpause() {
    let mut config = Config {
        verifier: verifier(1),
        bump: 1,
    };
    let mut control = Control {
        bump: 2,
        paused: true,
        verifier_epoch: 1,
    };
    assert!(require_running(&control).is_err());
    assert!(require_claim_control(&control, 1).is_err());
    rotate_config(&mut config, &mut control, verifier(100)).unwrap();
    assert!(control.paused);
    assert!(require_claim_control(&control, 2).is_err());
    control.paused = false;
    assert!(require_running(&control).is_ok());
    assert!(require_claim_control(&control, 2).is_ok());
    assert!(require_claim_control(&control, 0).is_err());
    assert!(require_claim_control(&control, 1).is_err());
}
#[test]
fn invalid_verifiers_and_epoch_overflow_leave_configuration_unchanged() {
    let a = verifier(1);
    let mut config = Config {
        verifier: a,
        bump: 1,
    };
    let mut control = Control {
        bump: 2,
        paused: true,
        verifier_epoch: 1,
    };
    let off_curve = Pubkey::find_program_address(&[b"not-an-ed25519-signer"], &crate::ID).0;
    for invalid in [Pubkey::default(), off_curve] {
        assert!(rotate_config(&mut config, &mut control, invalid).is_err());
        assert_eq!(config.verifier, a);
        assert_eq!(control.verifier_epoch, 1);
        assert!(control.paused);
    }
    control.verifier_epoch = u64::MAX;
    assert!(rotate_config(&mut config, &mut control, verifier(100)).is_err());
    assert_eq!(config.verifier, a);
    assert_eq!(control.verifier_epoch, u64::MAX);
}
#[test]
fn existing_config_layout_stays_compatible_and_control_layout_is_exact() {
    let config = Config {
        verifier: verifier(1),
        bump: 254,
    };
    let mut encoded = Vec::new();
    config.try_serialize(&mut encoded).unwrap();
    assert_eq!(encoded.len(), 41);
    assert_eq!(encoded[40], 254);
    let control = Control {
        bump: 253,
        paused: true,
        verifier_epoch: 9,
    };
    let mut encoded = Vec::new();
    control.try_serialize(&mut encoded).unwrap();
    assert_eq!(encoded.len(), 18);
    assert_eq!(encoded[8], 253);
    assert_eq!(encoded[9], 1);
    assert_eq!(&encoded[10..18], &9u64.to_le_bytes());
}
fn test_account(
    key: Pubkey,
    owner: Pubkey,
    data: Vec<u8>,
    signer: bool,
    writable: bool,
    executable: bool,
) -> AccountInfo<'static> {
    AccountInfo::new(
        Box::leak(Box::new(key)),
        signer,
        writable,
        Box::leak(Box::new(1_000_000)),
        Box::leak(data.into_boxed_slice()),
        Box::leak(Box::new(owner)),
        executable,
        0,
    )
}
fn management_accounts(
    authority: Pubkey,
    loader_authority: Option<Pubkey>,
) -> Vec<AccountInfo<'static>> {
    use anchor_lang::solana_program::bpf_loader_upgradeable;
    let loader = bpf_loader_upgradeable::ID;
    let program_data = Pubkey::new_unique();
    let (config_key, config_bump) = Pubkey::find_program_address(&[b"config"], &crate::ID);
    let (control_key, control_bump) = Pubkey::find_program_address(&[b"control"], &crate::ID);
    let mut config_data = Vec::new();
    Config {
        verifier: verifier(1),
        bump: config_bump,
    }
    .try_serialize(&mut config_data)
    .unwrap();
    let mut control_data = Vec::new();
    Control {
        bump: control_bump,
        paused: false,
        verifier_epoch: 1,
    }
    .try_serialize(&mut control_data)
    .unwrap();
    // UpgradeableLoaderState's bincode wire representation (Program/ProgramData).
    let mut program_bytes = 2u32.to_le_bytes().to_vec();
    program_bytes.extend(program_data.to_bytes());
    let mut loader_bytes = 3u32.to_le_bytes().to_vec();
    loader_bytes.extend(0u64.to_le_bytes());
    loader_bytes.push(u8::from(loader_authority.is_some()));
    if let Some(key) = loader_authority {
        loader_bytes.extend(key.to_bytes());
    }
    vec![
        test_account(authority, System::id(), vec![], true, false, false),
        test_account(config_key, crate::ID, config_data, false, true, false),
        test_account(control_key, crate::ID, control_data, false, true, false),
        test_account(crate::ID, loader, program_bytes, false, false, true),
        test_account(program_data, loader, loader_bytes, false, false, false),
    ]
}
fn accepts_management(accounts: &[AccountInfo<'static>]) -> bool {
    let mut remaining: &'static [AccountInfo<'static>] =
        Box::leak(accounts.to_vec().into_boxed_slice());
    ManageControl::try_accounts(
        &crate::ID,
        &mut remaining,
        &[],
        &mut ManageControlBumps::default(),
        &mut std::collections::BTreeSet::new(),
    )
    .is_ok()
}
#[test]
fn management_checks_actual_current_loader_authority_not_a_stored_admin() {
    let current = Pubkey::new_unique();
    let former = Pubkey::new_unique();
    assert!(accepts_management(&management_accounts(
        current,
        Some(current)
    )));
    assert!(!accepts_management(&management_accounts(
        former,
        Some(current)
    )));
    assert!(!accepts_management(&management_accounts(current, None)));
    let mut unsigned = management_accounts(current, Some(current));
    unsigned[0].is_signer = false;
    assert!(!accepts_management(&unsigned));
    let mut false_program_data = management_accounts(current, Some(current));
    false_program_data[4].key = Box::leak(Box::new(Pubkey::new_unique()));
    assert!(!accepts_management(&false_program_data));
    let mut false_owner = management_accounts(current, Some(current));
    false_owner[4].owner = Box::leak(Box::new(System::id()));
    assert!(!accepts_management(&false_owner));
    let mut false_program = management_accounts(current, Some(current));
    false_program[3].key = Box::leak(Box::new(Pubkey::new_unique()));
    assert!(!accepts_management(&false_program));
    let mut false_control = management_accounts(current, Some(current));
    false_control[2].key = Box::leak(Box::new(Pubkey::new_unique()));
    assert!(!accepts_management(&false_control));
    assert!(!accepts_management(
        &management_accounts(current, Some(current))[..2]
    ));
}
