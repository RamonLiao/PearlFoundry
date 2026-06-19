// Task 8 testnet round-trip — shared config.
// Oracle IDs are EPHEMERAL (15-min rolling); ORACLE/MGR are passed via env, not hardcoded.
export const RPC = 'https://fullnode.testnet.sui.io:443';
export const ADDR = '0x1509b5fdf09296b2cf749a710e36da06f5693ccd5b2144ad643b3a895abcbc4c';

export const PKG = '0xa69904d3bafe89a197da763f3c5c7ca39522aa3d81974b3910ad5c261bdcb21a';
export const CFG = '0xc8516309c6c65dd71a910a966abb8e74284ecb49eaaae1607acbf7440f249351';
export const VAULT = '0x9991245eed652140437bcda579c5ff6f7f7fae13986d6145d65941abacd75c2c';

export const PREDICT = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
export const DUSDC = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
export const CLOCK = '0x6';

// price scale = 1e9 (9 decimals); BTC spot ~ $62,448
export const SCALE = 1_000_000_000n;
