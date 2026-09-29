import test from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt, encryptionReady } from '../server/secrets.js';
import { localCodexAllowed } from '../server/codexLogin.js';

test('saved API keys round-trip through AES-256-GCM only for their owner and reject tampering or a changed secret',()=>{
  const previous=process.env.ATLAS_ENCRYPTION_KEY;
  process.env.ATLAS_ENCRYPTION_KEY='test-secret-that-is-at-least-32-characters';
  try{
    assert.equal(encryptionReady(),true);
    const sealed=encrypt('sk-test-1234567890abcdefghij','user_a');
    assert.match(sealed,/^v1:/);
    assert.equal(sealed.includes('sk-test'),false);
    assert.equal(decrypt(sealed,'user_a'),'sk-test-1234567890abcdefghij');
    assert.equal(decrypt(sealed,'user_b'),null,'another user cannot use this ciphertext');
    const parts=sealed.split(':');parts[3]=Buffer.from('tampered').toString('base64');
    assert.equal(decrypt(parts.join(':'),'user_a'),null);
    process.env.ATLAS_ENCRYPTION_KEY='a-different-secret-of-at-least-32-chars!!';
    assert.equal(decrypt(sealed,'user_a'),null);
    process.env.ATLAS_ENCRYPTION_KEY='too-short';
    assert.equal(encryptionReady(),false);
  }finally{process.env.ATLAS_ENCRYPTION_KEY=previous}
});

test('Connect Codex is limited to a local development server',()=>{
  const previous=process.env.NODE_ENV;
  try{
    process.env.NODE_ENV='development';
    assert.equal(localCodexAllowed(new Request('http://localhost:3000/api/codex/login')),true);
    assert.equal(localCodexAllowed(new Request('https://atlas.example.com/api/codex/login')),false);
    process.env.NODE_ENV='production';
    assert.equal(localCodexAllowed(new Request('http://localhost:3000/api/codex/login')),false);
  }finally{process.env.NODE_ENV=previous}
});
