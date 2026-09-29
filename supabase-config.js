/* Configuration Supabase de l'espace client.
   Supabase > bouton « Connect » : copier l'URL du projet et la clé « publishable » (sb_publishable_...).
   La clé anon est faite pour être publique : ce sont les règles RLS de supabase/schema.sql
   qui protègent les données. Ne JAMAIS mettre ici la clé « service_role ». */
window.GK_SUPABASE = {
  url: 'https://elkaenirztjvsslrcwsz.supabase.co',
  anonKey: 'sb_publishable_RbN1_bNA5aHln-vhS3CjBQ_TDq3Tq2H'
};
