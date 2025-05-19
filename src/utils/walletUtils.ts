import { ethers } from 'ethers';
import { Keypair } from '@solana/web3.js';
import CryptoJS from 'crypto-js';
import { generateMnemonic, mnemonicToSeedSync } from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';

const bip32 = BIP32Factory(ecc);

// Encryption key - should be stored securely in environment variables
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-secure-key';

export function encryptData(data: string): string {
    return CryptoJS.AES.encrypt(data, ENCRYPTION_KEY).toString();
}

export function decryptData(encryptedData: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedData, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
}

export function generateEthereumWallet() {
    const wallet = ethers.Wallet.createRandom();
    return {
        address: wallet.address,
        privateKey: wallet.privateKey
    };
}

export function generateSolanaWallet() {
    const keypair = Keypair.generate();
    return {
        address: keypair.publicKey.toString(),
        privateKey: Buffer.from(keypair.secretKey).toString('hex')
    };
}

export function generateBitcoinWallet() {
    const mnemonic = generateMnemonic();
    const seed = mnemonicToSeedSync(mnemonic);
    const root = bip32.fromSeed(seed);
    const path = "m/44'/0'/0'/0/0";
    const child = root.derivePath(path);
    
    if (!child.privateKey) {
        throw new Error('Failed to generate private key');
    }

    const network = bitcoin.networks.bitcoin;
    const { address } = bitcoin.payments.p2pkh({ 
        pubkey: child.publicKey,
        network 
    });

    if (!address) {
        throw new Error('Failed to generate address');
    }

    return {
        address,
        privateKey: child.privateKey.toString('hex'),
        mnemonic
    };
}

export function validateAddress(address: string, type: 'ETH' | 'SOL' | 'BTC'): boolean {
    try {
        switch (type) {
            case 'ETH':
                return ethers.isAddress(address);
            case 'SOL':
                // Basic Solana address validation
                return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
            case 'BTC':
                // Basic Bitcoin address validation
                return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) || 
                       /^bc1[ac-hj-np-z02-9]{11,71}$/.test(address);
            default:
                return false;
        }
    } catch (error) {
        return false;
    }
} 