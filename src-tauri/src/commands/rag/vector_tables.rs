pub fn rag_vector_table_name(dimension: i64) -> Result<String, String> {
    if !(1..=32768).contains(&dimension) {
        return Err(format!("本地 RAG embedding 维度无效: {}", dimension));
    }

    Ok(format!("rag_chunk_vec_{}", dimension))
}
