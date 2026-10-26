import { defineConfig } from "wxt";

export default defineConfig({
  modules: [],
  manifest: {
    name: "Embassy Form Assistant",
    description: "Autonomous RAG Form Filler with Side Panel Review.",
    permissions: [
      "activeTab",
      "tabs",
      "scripting",
      "storage",
      "sidePanel",
      "identity",
      "notifications"
    ],
    optional_host_permissions: [
      "http://localhost/*",
      "http://127.0.0.1/*",
      "https://*/*"
    ],
    action: {
      default_title: "Open Embassy Form Assistant"
    },
    side_panel: {
      default_path: "sidepanel.html"
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'"
    }
  }
});
