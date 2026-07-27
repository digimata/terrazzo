//! Markdown → static HTML for canvas note cards (PR-009). The card is a
//! preview, never an editor: cards and the editor share typography, but only
//! the active document mounts CodeMirror.

use pulldown_cmark::{html, Event, Options, Parser};

/// Cap the bytes fed to the renderer — a card shows only the top of the
/// document, and shipping a 2MB note's HTML to every card is waste.
const PREVIEW_BYTES: usize = 16 * 1024;

/// Render a Markdown preview. Raw HTML in the source is demoted to text so
/// nothing an `.md` file contains is ever interpreted by the webview
/// (v0 §3.1: raw HTML in Markdown is disabled).
pub fn render_preview(text: &str) -> String {
    let mut end = text.len().min(PREVIEW_BYTES);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(&text[..end], opts).map(|ev| match ev {
        Event::Html(s) | Event::InlineHtml(s) => Event::Text(s),
        ev => ev,
    });
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}
