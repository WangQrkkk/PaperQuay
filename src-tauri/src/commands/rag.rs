pub(crate) mod commands;
mod models;
mod schema;
mod vector_tables;

pub(crate) use schema::{migrate_rag_schema, register_sqlite_vec_once};
