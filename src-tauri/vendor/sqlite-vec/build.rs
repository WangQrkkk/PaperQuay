fn main() {
    cc::Build::new()
        .file("sqlite-vec.c")
        .define("SQLITE_CORE", None)
        .define("SQLITE_VEC_ENABLE_DISKANN", "0")
        .define("SQLITE_VEC_ENABLE_RESCORE", "0")
        .compile("sqlite_vec0");
}
