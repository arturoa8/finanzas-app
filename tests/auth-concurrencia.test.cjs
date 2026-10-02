const assert=require('node:assert/strict');
const {entornoPrueba,modulo}=require('./helpers/app-root.cjs');
entornoPrueba();
(async()=>{
  const auth=await modulo('services/auth.js');
  const sesion=expires=>localStorage.setItem('sb_session',JSON.stringify({access_token:'demo',refresh_token:'refresh-demo',expires_at:expires,user_id:'user-demo'}));
  sesion(Date.now()+30000);let pedidos=0;
  globalThis.fetch=async()=>{pedidos++;await new Promise(r=>setTimeout(r,10));return new Response(JSON.stringify({access_token:'nuevo',refresh_token:'refresh-nuevo',expires_in:3600,user:{id:'user-demo'}}),{status:200,headers:{'content-type':'application/json'}});};
  const headers=await Promise.all(Array.from({length:9},()=>auth.authHeader()));
  assert.equal(pedidos,1);assert.ok(headers.every(h=>h==='Bearer nuevo'));assert.equal(auth.getSession().access_token,'nuevo');
  sesion(Date.now()+30000);globalThis.fetch=async()=>{throw Error('sin red');};
  assert.equal(await auth.authHeader(),'Bearer demo');assert.ok(auth.getSession());
  sesion(Date.now()-1000);await assert.rejects(auth.authHeader(),/conexión/);assert.ok(auth.getSession(),'un fallo temporal conserva el refresh token');
  globalThis.fetch=async()=>new Response(JSON.stringify({msg:'Refresh rechazado'}),{status:400});
  await auth.authHeader();assert.equal(auth.getSession(),null);
  sesion(Date.now()+30000);globalThis.fetch=async()=>{localStorage.removeItem('sb_session');return new Response(JSON.stringify({access_token:'nuevo',refresh_token:'nuevo',expires_in:3600}),{status:200});};
  await auth.authHeader();assert.equal(auth.getSession(),null,'un refresh no restaura una sesión cerrada');
  console.log('PASS: un refresh compartido, error de red, credenciales rechazadas y cierre durante refresh.');
})().catch(e=>{console.error(e);process.exitCode=1;});
