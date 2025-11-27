// generate-hash.js - Generate bcrypt password hashes for ADMIN_USERS
import bcrypt from 'bcrypt';

const password = process.argv[2];
if (!password) {
    console.log('Usage: node generate-hash.js <password>');
    process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log('\nPassword hash:');
console.log(hash);
console.log('\nFor ADMIN_USERS env var:');
console.log(`{"username":"${hash}"}`);
console.log('\nReplace "username" with the actual username you want to use.');
