mod commands;
mod startup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup::configure_runtime_environment();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::file::get_app_default_paths,
            commands::file::select_pdf_file,
            commands::file::select_json_file,
            commands::file::select_attachment_files,
            commands::file::capture_system_screenshot,
            commands::file::open_external_url,
            commands::file::select_directory,
            commands::file::list_directory_files,
            commands::file::select_save_pdf_path,
            commands::file::path_exists,
            commands::file::read_text_file,
            commands::file::read_binary_file_base64,
            commands::file::approve_write_path,
            commands::file::write_text_file,
            commands::file::write_binary_file_base64,
            commands::file::download_remote_file_to_path,
            commands::library::import::library_select_pdf_files,
            commands::library::library_init,
            commands::library::library_get_settings,
            commands::library::library_update_settings,
            commands::library::categories::library_list_categories,
            commands::library::categories::library_create_category,
            commands::library::categories::library_update_category,
            commands::library::categories::library_move_category,
            commands::library::categories::library_delete_category,
            commands::library::papers::library_list_papers,
            commands::library::papers::library_reorder_papers,
            commands::library::import::library_import_pdfs,
            commands::library::papers::library_assign_paper_category,
            commands::library::papers::library_update_paper,
            commands::library::papers::library_delete_paper,
            commands::library::papers::library_relocate_attachment,
            commands::metadata::lookup_literature_metadata,
            commands::mineru::run_mineru_cloud_parse,
            commands::llm::test_openai_compatible_chat,
            commands::translation::translate_blocks_openai_compatible,
            commands::summary::summarize_document_openai_compatible,
            commands::qa::ask_document_openai_compatible,
            commands::qa::ask_document_openai_compatible_stream,
            commands::agent::generate_library_agent_plan_openai_compatible,
            commands::zotero::zotero_lookup_key,
            commands::zotero::zotero_list_library_items,
            commands::zotero::zotero_download_attachment_pdf,
            commands::zotero::zotero_detect_local_data_dir,
            commands::zotero::zotero_select_local_data_dir,
            commands::zotero::zotero_list_local_collections,
            commands::zotero::zotero_list_local_library_items,
            commands::zotero::zotero_list_local_collection_items,
            commands::zotero::zotero_list_related_notes
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the PaperQuay application");
}
