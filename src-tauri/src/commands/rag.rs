pub(crate) mod commands;
mod models;
mod schema;
mod vector_tables;

pub(crate) use schema::{ensure_rag_vector_table, migrate_rag_schema, register_sqlite_vec_once};
pub(crate) use vector_tables::rag_vector_table_name;
