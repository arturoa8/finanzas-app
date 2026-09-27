// Sesion, alta, acceso, refresco y cierre.
// Extraido de v2/propuesta.html sin cambiar su comportamiento.

import {cargar} from '../modules/transactions.js';
import {pfYahoo, stopPfYahoo} from './market-data.js';
import {SUPABASE_ANON_KEY, SUPABASE_URL} from './supabase-config.js';

// ── Auth (email + contraseña) ────────────────────────────────────────────
// Sin login, la anon key sola le da acceso a cualquiera a todos los datos
// (queda visible en el HTML público). Con esto, las políticas RLS en Supabase
// exigen además una sesión válida de tu propia cuenta.
const AUTH_URL=`${SUPABASE_URL}/auth/v1`;

export function getSession(){try{return JSON.parse(localStorage.getItem('sb_session')||'null');}catch(e){return null;}}

function setSession(s){if(s)localStorage.setItem('sb_session',JSON.stringify(s));else localStorage.removeItem('sb_session');}

async function authRequest(path,body){
  const r=await fetch(`${AUTH_URL}${path}`,{method:'POST',headers:{apikey:SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error_description||data.msg||data.error||'Error de autenticación');
  return data;
}

async function signIn(email,password){
  const data=await authRequest('/token?grant_type=password',{email,password});
  setSession({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+(data.expires_in*1000)});
  return data;
}

async function signUp(email,password){return authRequest('/signup',{email,password});}

async function refreshSession(){
  const s=getSession(); if(!s||!s.refresh_token)return null;
  try{
    const data=await authRequest('/token?grant_type=refresh_token',{refresh_token:s.refresh_token});
    setSession({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+(data.expires_in*1000)});
    return data;
  }catch(e){setSession(null);return null;}
}

export function signOut(){stopPfYahoo();pfYahoo.quotes=[];setSession(null);location.reload();}

export async function authHeader(){
  let s=getSession();
  if(s&&s.expires_at-Date.now()<60000)s=await refreshSession();
  return s?('Bearer '+s.access_token):('Bearer '+SUPABASE_ANON_KEY);
}

// ── Arranque: exige sesión antes de mostrar la app ───────────────────────
let authMode='signin';

export function toggleAuthMode(){
  authMode=authMode==='signin'?'signup':'signin';
  document.getElementById('authTitle').textContent=authMode==='signin'?'Iniciar sesión':'Crear cuenta';
  document.getElementById('authSubmitBtn').textContent=authMode==='signin'?'Entrar':'Crear cuenta';
  document.getElementById('authToggleLbl').textContent=authMode==='signin'?'¿Primera vez?':'¿Ya tienes cuenta?';
  document.getElementById('authToggleLink').textContent=authMode==='signin'?'Crear cuenta':'Iniciar sesión';
  document.getElementById('authError').textContent='';
}

export async function submitAuth(){
  const email=document.getElementById('authEmail').value.trim();
  const password=document.getElementById('authPassword').value;
  const errEl=document.getElementById('authError');
  errEl.style.color='var(--red)';
  errEl.textContent='';
  if(!email||!password){errEl.textContent='Completa correo y contraseña';return;}
  try{
    if(authMode==='signin'){
      await signIn(email,password);
      ocultarAuthGate();
      cargar();
    }else{
      await signUp(email,password);
      toggleAuthMode();
      errEl.style.color='var(--green)';
      errEl.textContent='Cuenta creada. Revisa tu correo si te pide confirmarlo, luego inicia sesión.';
    }
  }catch(e){errEl.style.color='var(--red)';errEl.textContent=e.message||'Error de autenticación';}
}

function ocultarAuthGate(){document.getElementById('authGate').style.display='none';}

export async function bootAuth(){
  let s=getSession();
  if(s&&s.expires_at-Date.now()<60000)s=await refreshSession();
  if(s){ocultarAuthGate();cargar();}
  // si no hay sesión, se queda mostrando #authGate (visible por defecto)
}
