import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { connection, client, defaultCurve, QUOTE_MINTS, assertDevnet } from "../src/index.ts";
const root=resolve(import.meta.dirname,"../../.."),directory=resolve(root,".data/devnet");await mkdir(directory,{recursive:true});
const keyPath=resolve(directory,"deployer.json");let wallet;
try{wallet=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyPath,"utf8"))));}catch{wallet=Keypair.generate();await writeFile(keyPath,JSON.stringify([...wallet.secretKey]),{mode:0o600});}
await assertDevnet();const rpc=connection();const balance=await rpc.getBalance(wallet.publicKey);
console.log(`Devnet test-only deployer: ${wallet.publicKey.toBase58()} (${balance/1e9} SOL)`);
if(balance<300_000_000){try{const signature=await rpc.requestAirdrop(wallet.publicKey,2_000_000_000);console.log(`Airdrop requested: ${signature}`);for(let n=0;n<12;n++){await new Promise(resolve=>setTimeout(resolve,2000));if(await rpc.getBalance(wallet.publicKey)>=300_000_000)break;}}catch{console.log("Faucet unavailable. Fund this address with devnet SOL and run the script again.");}}
if(await rpc.getBalance(wallet.publicKey)<300_000_000)process.exit(2);
const output={};
for(const quote of ["SOL","USDC"]){const configPath=resolve(directory,`config-${quote}.json`);let config;
  try{config=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(configPath,"utf8"))));}catch{config=Keypair.generate();await writeFile(configPath,JSON.stringify([...config.secretKey]),{mode:0o600});}
  if(!(await rpc.getAccountInfo(config.publicKey))){
    const tx=await client().partner.createConfig({...defaultCurve(quote),payer:wallet.publicKey,config:config.publicKey,feeClaimer:wallet.publicKey,leftoverReceiver:wallet.publicKey,quoteMint:new PublicKey(QUOTE_MINTS[quote])});
    const latest=await rpc.getLatestBlockhash();tx.feePayer=wallet.publicKey;tx.recentBlockhash=latest.blockhash;tx.sign(wallet,config);
    const signature=await rpc.sendRawTransaction(tx.serialize());const confirmation=await rpc.confirmTransaction({...latest,signature},"confirmed");if(confirmation.value.err)throw new Error(`Config transaction failed: ${signature}`);console.log(`${quote} config created: ${signature}`);
  }
  output[`DBC_CONFIG_${quote}`]=config.publicKey.toBase58();console.log(`DBC_CONFIG_${quote}=${config.publicKey.toBase58()}`);
}
await writeFile(resolve(directory,"public-config.json"),JSON.stringify(output,null,2));
