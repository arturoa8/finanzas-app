// Direccion y clave publica del proyecto Supabase.
// Modulo hoja, sin imports: auth.js y supabase.js se importan entre si, y
// si estas constantes vivieran en uno de ellos el orden de carga del ciclo
// podria leerlas antes de inicializarse (ReferenceError al arrancar).

export const SUPABASE_URL='https://uyaitpzjrzzvspwcvgrn.supabase.co';

export const SUPABASE_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV5YWl0cHpqcnp6dnNwd2N2Z3JuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5MjYxMDYsImV4cCI6MjEwMzUwMjEwNn0.LaL1MRc1e1J8sVaF-oSZIWiOhICXgHM8wgC6tZQ1hSI';
