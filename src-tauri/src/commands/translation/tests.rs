use super::*;

fn block(id: &str, text: &str) -> TranslateBlockInput {
    TranslateBlockInput {
        block_id: id.to_string(),
        text: text.to_string(),
    }
}

fn output(id: &str, translated_text: &str) -> TranslateBlockOutput {
    TranslateBlockOutput {
        block_id: id.to_string(),
        translated_text: translated_text.to_string(),
    }
}

#[test]
fn estimate_batch_translation_max_tokens_scales_with_source_size() {
    let short_batch = vec![block("a", "Short source text.")];
    let long_batch = vec![block(
        "a",
        "This is a significantly longer source passage that should require a noticeably larger completion token budget than the short example.",
    )];

    let short_budget = estimate_batch_translation_max_tokens(&short_batch);
    let long_budget = estimate_batch_translation_max_tokens(&long_batch);

    assert!(short_budget >= 256);
    assert!(long_budget > short_budget);
    assert!(long_budget <= 12_000);
}

#[test]
fn translation_output_guard_flags_excessive_expansion() {
    let source_blocks = vec![block("a", "A concise source sentence.")];
    let normal_outputs = vec![output("a", "A concise translated sentence.")];
    let runaway_outputs = vec![output("a", &"translated ".repeat(800))];

    assert!(!translation_output_is_excessive(
        &source_blocks,
        &normal_outputs
    ));
    assert!(translation_output_is_excessive(
        &source_blocks,
        &runaway_outputs
    ));
}

#[test]
fn clean_plaintext_translation_unwraps_json_string_payloads() {
    assert_eq!(
        clean_plaintext_translation("\"已经翻译好的文本\""),
        "已经翻译好的文本"
    );
}

#[test]
fn clean_plaintext_translation_extracts_single_translation_json() {
    assert_eq!(
        clean_plaintext_translation(
            "{\"blockId\":\"selection\",\"translatedText\":\"提取出来的译文\"}"
        ),
        "提取出来的译文"
    );
}

#[test]
fn retryable_plaintext_translation_errors_cover_eof_and_empty_content() {
    assert!(is_retryable_plaintext_translation_error(
        "Failed to parse chat/completions response: EOF while parsing a value"
    ));
    assert!(is_retryable_plaintext_translation_error(
        "chat/completions 响应缺少 message.content"
    ));
    assert!(is_retryable_plaintext_translation_error(
        "Translation did not produce usable content for block selection"
    ));
    assert!(!is_retryable_plaintext_translation_error(
        "Translation endpoint HTTP status error: 401 Unauthorized"
    ));
}
