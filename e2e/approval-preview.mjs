// Synthetic, isolated visual preview. Stops after 15 minutes or Ctrl+C.
import { withWorker, ORIGIN } from './harness.mjs';
await withWorker(async () => {
 console.log(`Preview ready: ${ORIGIN}/login\nChoose Alice (fixture), then /org/demo-jakarta/approval or /org/demo-jakarta/purposes/1. No real data or email.`);
 await new Promise((resolve) => {
  const timer=setTimeout(resolve,15*60*1000);
  process.once('SIGINT',()=>{clearTimeout(timer);resolve();});
  process.once('SIGTERM',()=>{clearTimeout(timer);resolve();});
 });
});
