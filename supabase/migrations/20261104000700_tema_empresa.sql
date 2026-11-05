-- Paleta de colores de cada empresa en la interfaz (diseño: El Catador y Bona).
alter table empresas add column tema text not null default 'catador' check (tema in ('catador', 'bona'));
