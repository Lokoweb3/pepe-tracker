const { Connection, PublicKey } = require('@solana/web3.js');

// Configuration
const X1_RPC = 'https://rpc.mainnet.x1.xyz';
const POOL_ADDRESS = new PublicKey('FAVw1iDioK69epJf1YY3Z1oakSCUYtmfUpVBxR14BGpm');

console.log('\n🔍 Finding Token Mint Addresses for Pool\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Pool Address:', POOL_ADDRESS.toBase58());
console.log('RPC:', X1_RPC);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

async function findMintAddresses() {
    const connection = new Connection(X1_RPC, 'confirmed');
    
    try {
        console.log('📡 Fetching pool account info...\n');
        
        // Get account info
        const accountInfo = await connection.getAccountInfo(POOL_ADDRESS);
        
        if (!accountInfo) {
            console.log('❌ Pool account not found!');
            return;
        }
        
        console.log('✅ Pool account found!');
        console.log('   Owner:', accountInfo.owner.toBase58());
        console.log('   Data size:', accountInfo.data.length, 'bytes\n');
        
        // Get token accounts owned by this pool
        console.log('🔍 Fetching token accounts...\n');
        
        const tokenAccounts = await connection.getTokenAccountsByOwner(
            POOL_ADDRESS,
            { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
        );
        
        console.log(`📊 Found ${tokenAccounts.value.length} token accounts:\n`);
        
        if (tokenAccounts.value.length === 0) {
            console.log('   No token accounts found.');
            console.log('   The pool might use a different structure.\n');
        }
        
        for (let i = 0; i < tokenAccounts.value.length; i++) {
            const account = tokenAccounts.value[i];
            const accountData = account.account.data;
            
            // Parse token account data (SPL Token layout)
            // Mint is at bytes 0-32
            const mintBytes = accountData.slice(0, 32);
            const mint = new PublicKey(mintBytes).toBase58();
            
            // Amount is at bytes 64-72 (8 bytes, little-endian)
            const amountBuffer = accountData.slice(64, 72);
            const amount = amountBuffer.readBigUInt64LE(0);
            
            console.log(`   Token ${i + 1}:`);
            console.log(`   ├─ Account: ${account.pubkey.toBase58()}`);
            console.log(`   ├─ Mint:    ${mint}`);
            console.log(`   └─ Amount:  ${amount.toString()}\n`);
        }
        
        // Try to get recent transactions to see mints in action
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔍 Analyzing recent transactions...\n');
        
        const signatures = await connection.getSignaturesForAddress(
            POOL_ADDRESS,
            { limit: 5 }
        );
        
        console.log(`📝 Found ${signatures.length} recent transactions\n`);
        
        for (let i = 0; i < Math.min(signatures.length, 3); i++) {
            const sig = signatures[i];
            console.log(`   Transaction ${i + 1}: ${sig.signature.substring(0, 16)}...`);
            
            const tx = await connection.getParsedTransaction(sig.signature, {
                maxSupportedTransactionVersion: 0
            });
            
            if (tx && tx.meta && tx.meta.preTokenBalances) {
                const mints = new Set();
                
                tx.meta.preTokenBalances.forEach(balance => {
                    mints.add(balance.mint);
                });
                
                tx.meta.postTokenBalances.forEach(balance => {
                    mints.add(balance.mint);
                });
                
                console.log(`   ├─ Tokens involved:`);
                mints.forEach(mint => {
                    console.log(`   │  └─ ${mint}`);
                });
                console.log('');
            }
        }
        
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ Analysis Complete!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        
        console.log('📝 To use these in server.js, update lines 16-17:');
        console.log('\n   const XNT_MINT = \'MINT_ADDRESS_HERE\';');
        console.log('   const PEPE_MINT = \'MINT_ADDRESS_HERE\';\n');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error('\nPossible issues:');
        console.error('  - RPC endpoint might be down or incorrect');
        console.error('  - Pool address might be invalid');
        console.error('  - Network connectivity issues\n');
    }
}

// Run the script
findMintAddresses();