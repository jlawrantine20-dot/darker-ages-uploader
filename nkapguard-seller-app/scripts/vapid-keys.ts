// Prints a new VAPID key pair for push notifications: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.
import { generateVapidKeys } from '../src/channels/webpush.js';

const k = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
