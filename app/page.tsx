"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DecoderDocumentDetail,
  DecoderDocumentSummary,
  DocumentStatus,
  ReviewStatus
} from "@/lib/decoder-types";

const iconPaths = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" />
    </>
  ),
  doc: (
    <>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5" />
      <path d="M10 13h6M10 17h4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-5" />
    </>
  ),
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4z" />
    </>
  )
};

type Filter = "all" | "pending" | "memory" | "credentials" | "whatsapp" | "disabled" | DocumentStatus;
type ReviewAction = "approve" | "flag" | "clearer_photo" | "reset";
type UiLanguage = "en" | "es";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      {children}
    </svg>
  );
}

export default function Home() {
  const [documents, setDocuments] = useState<DecoderDocumentSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DecoderDocumentDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [uploadStatus, setUploadStatus] = useState("");
  const [extractStatus, setExtractStatus] = useState("");
  const [explainStatus, setExplainStatus] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("en");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockStatus, setUnlockStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const isSpanish = uiLanguage === "es";
  const ui = (english: string, spanish: string) => (isSpanish ? spanish : english);

  useEffect(() => {
    refreshDocuments();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDocument(null);
      return;
    }

    loadDocument(selectedId);
  }, [selectedId]);

  async function refreshDocuments(nextSelectedId?: string) {
    setIsLoading(true);
    try {
      const response = await fetch("/api/documents");
      const data = (await response.json()) as { documents: DecoderDocumentSummary[] };
      setDocuments(data.documents);

      const nextId = nextSelectedId ?? selectedId;
      if (nextId && data.documents.some((document) => document.id === nextId)) {
        setSelectedId(nextId);
      } else {
        setSelectedId(data.documents[0]?.id ?? null);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDocument(documentId: string) {
    const response = await fetch(`/api/documents/${documentId}`);
    if (!response.ok) {
      setSelectedDocument(null);
      return;
    }

    const data = (await response.json()) as { document: DecoderDocumentDetail };
    setSelectedDocument(data.document);
    setUnlockStatus("");
  }

  async function unlockSensitiveInfo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;

    setIsUnlocking(true);
    setUnlockStatus(ui("Checking password...", "Verificando contraseña..."));

    try {
      const response = await fetch("/api/reviewer/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: unlockPassword })
      });

      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setUnlockStatus(data?.error ?? ui("Could not unlock.", "No se pudo desbloquear."));
        return;
      }

      setUnlockPassword("");
      setUnlockStatus(ui("Sensitive information unlocked.", "Información sensible desbloqueada."));
      await loadDocument(selectedId);
      await refreshDocuments(selectedId);
    } catch {
      setUnlockStatus(ui("Could not unlock.", "No se pudo desbloquear."));
    } finally {
      setIsUnlocking(false);
    }
  }

  async function uploadDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setIsUploading(true);
    setUploadStatus(ui("Saving the original document...", "Guardando el documento original..."));

    const formData = new FormData();
    formData.append("file", file);
    formData.append("userPhone", "web-test");

    try {
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setUploadStatus(data?.error ?? ui("Could not upload the document.", "No se pudo subir el documento."));
        return;
      }

      const data = (await response.json()) as { document: DecoderDocumentSummary };
      setUploadStatus(ui("Document saved. Ready for extraction.", "Documento guardado. Listo para extracción."));
      await refreshDocuments(data.document.id);
    } catch {
      setUploadStatus(ui("Could not upload the document.", "No se pudo subir el documento."));
    } finally {
      setIsUploading(false);
    }
  }

  async function extractSelectedDocument() {
    if (!selectedId) return;

    setIsExtracting(true);
    setExtractStatus(ui("Extracting evidence-backed facts...", "Extrayendo facts con evidencia..."));

    try {
      const response = await fetch(`/api/documents/${selectedId}/extract`, {
        method: "POST"
      });

      const data = (await response.json().catch(() => null)) as
        | { document?: DecoderDocumentDetail; error?: string }
        | null;

      if (!response.ok || !data?.document) {
        setExtractStatus(data?.error ?? ui("Could not extract the document.", "No se pudo extraer el documento."));
        return;
      }

      setSelectedDocument(data.document);
      setExtractStatus(ui("Facts extracted and saved.", "Facts extraídos y guardados."));
      await refreshDocuments(data.document.id);
    } catch {
      setExtractStatus(ui("Could not extract the document.", "No se pudo extraer el documento."));
    } finally {
      setIsExtracting(false);
    }
  }

  async function explainSelectedDocument() {
    if (!selectedId) return;

    setIsExplaining(true);
    setExplainStatus(ui("Generating explanation...", "Generando explicación..."));

    try {
      const response = await fetch(`/api/documents/${selectedId}/explain`, {
        method: "POST"
      });

      const data = (await response.json().catch(() => null)) as
        | { document?: DecoderDocumentDetail; error?: string }
        | null;

      if (!response.ok || !data?.document) {
        setExplainStatus(data?.error ?? ui("Could not generate the explanation.", "No se pudo generar la explicación."));
        return;
      }

      setSelectedDocument(data.document);
      setExplainStatus(ui("Explanation generated. Human review is still needed.", "Explicación generada. Falta revisión humana."));
      await refreshDocuments(data.document.id);
    } catch {
      setExplainStatus(ui("Could not generate the explanation.", "No se pudo generar la explicación."));
    } finally {
      setIsExplaining(false);
    }
  }

  async function reviewSelectedDocument(action: ReviewAction) {
    if (!selectedId) return;

    setIsReviewing(true);
    setReviewStatus(reviewActionPendingLabel(action, uiLanguage));

    try {
      const response = await fetch(`/api/documents/${selectedId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });

      const data = (await response.json().catch(() => null)) as
        | { document?: DecoderDocumentDetail; error?: string }
        | null;

      if (!response.ok || !data?.document) {
        setReviewStatus(data?.error ?? ui("Could not update the review.", "No se pudo actualizar la revisión."));
        return;
      }

      setSelectedDocument(data.document);
      setReviewStatus(reviewActionDoneLabel(action, uiLanguage));
      await refreshDocuments(data.document.id);
    } catch {
      setReviewStatus(ui("Could not update the review.", "No se pudo actualizar la revisión."));
    } finally {
      setIsReviewing(false);
    }
  }

  async function sendSelectedToWhatsApp() {
    if (!selectedId) return;

    setIsSending(true);
    setSendStatus(ui("Sending explanation through WhatsApp...", "Enviando explicación por WhatsApp..."));

    try {
      const response = await fetch(`/api/documents/${selectedId}/send-whatsapp`, {
        method: "POST"
      });

      const data = (await response.json().catch(() => null)) as
        | { document?: DecoderDocumentDetail; error?: string }
        | null;

      if (!response.ok || !data?.document) {
        setSendStatus(data?.error ?? ui("Could not send through WhatsApp.", "No se pudo enviar por WhatsApp."));
        return;
      }

      setSelectedDocument(data.document);
      setSendStatus(ui("Explanation sent through WhatsApp.", "Explicación enviada por WhatsApp."));
      await refreshDocuments(data.document.id);
    } catch {
      setSendStatus(ui("Could not send through WhatsApp.", "No se pudo enviar por WhatsApp."));
    } finally {
      setIsSending(false);
    }
  }

  const visibleDocuments = useMemo(() => {
    return documents.filter((document) => {
      if (filter === "all") return true;
      if (filter === "pending") return document.review_status === "pending";
      if (filter === "memory") return Boolean(document.memory_aliases?.length) && !document.memory_disabled;
      if (filter === "credentials") return Boolean(document.has_credential_facts);
      if (filter === "whatsapp") return document.source === "whatsapp";
      if (filter === "disabled") return Boolean(document.memory_disabled);
      return document.status === filter;
    });
  }, [documents, filter]);

  const pendingCount = documents.filter((document) => document.review_status === "pending").length;
  const explainedCount = documents.filter((document) => document.status === "explained").length;
  const memoryCount = documents.filter((document) => document.memory_aliases?.length).length;
  const credentialCount = documents.filter((document) => document.has_credential_facts).length;

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="side-brand">
          <img src="/ayudita-red.png" alt="Ayudita" />
        </div>
        <nav className="nav" aria-label="Ayudita">
          <button className="active">
            <Icon>{iconPaths.home}</Icon>
            Dashboard
          </button>
          <button>
            <Icon>{iconPaths.inbox}</Icon>
            {ui("Documents", "Documentos")}
          </button>
          <button>
            <Icon>{iconPaths.shield}</Icon>
            {ui("Review", "Revisión")}
          </button>
        </nav>
        <div className="side-status">
          <strong>
            <span className="dot" /> {ui("Raw-first active", "Raw-first activo")}
          </strong>
          <p>{ui("Every file is saved in Storage before any AI reads it.", "Cada archivo se guarda en Storage antes de cualquier lectura con AI.")}</p>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div className="brand">
            <span className="connection">
              <span className="dot" /> {ui("Supabase connected", "Supabase conectado")}
            </span>
          </div>
          <div className="topbar-actions">
            <div className="language-toggle" aria-label="Language">
              <button
                className={uiLanguage === "en" ? "active" : ""}
                onClick={() => setUiLanguage("en")}
              >
                English
              </button>
              <button
                className={uiLanguage === "es" ? "active" : ""}
                onClick={() => setUiLanguage("es")}
              >
                Español
              </button>
            </div>
            <button className="icon-button" title={ui("Pending review", "Revisión pendiente")} aria-label={ui("Pending review", "Revisión pendiente")}>
              <Icon>{iconPaths.shield}</Icon>
            </button>
          </div>
        </header>

        <main className="main">
          <section className="intro">
            <div>
              <p className="eyebrow">Decoder v1</p>
              <h1>{ui("Explain documents with evidence, without guessing.", "Explica documentos con evidencia, sin inventar.")}</h1>
              <p>
                {ui(
                  "Upload a photo, PDF, or screenshot. Ayudita saves the original first, detects the document type, and extracts facts before explaining.",
                  "Sube una foto, PDF o screenshot. Ayudita guarda el original primero, detecta el tipo de documento y extrae facts antes de explicar."
                )}
              </p>
            </div>
            <div className="trust-note">
              <strong>{ui("Main rule", "Regla principal")}</strong>
              <span>
                {ui(
                  "The original document is the source of truth. The explanation should only use extracted facts with source text.",
                  "El documento original es la fuente de verdad. La explicación solo debe hablar de facts extraídos con texto fuente."
                )}
              </span>
            </div>
          </section>

          <section className="ask-card upload-card" aria-label={ui("Upload document", "Subir documento")}>
            <div className="upload-copy">
              <Icon>{iconPaths.upload}</Icon>
              <div>
                <h2>{ui("Upload document", "Subir documento")}</h2>
                <p>{ui("JPG, PNG, WebP, or PDF. Maximum 20 MB.", "JPG, PNG, WebP o PDF. Máximo 20 MB.")}</p>
              </div>
            </div>
            <label className={`primary upload-button ${isUploading ? "disabled" : ""}`}>
              <Icon>{iconPaths.upload}</Icon>
              {isUploading ? ui("Uploading...", "Subiendo...") : ui("Choose file", "Elegir archivo")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={uploadDocument}
                disabled={isUploading}
              />
            </label>
            {uploadStatus ? <span className="upload-status">{uploadStatus}</span> : null}
          </section>

          <section className="metric-strip" aria-label={ui("Decoder status", "Estado del decoder")}>
            <div>
              <strong>{documents.length}</strong>
              <span>{ui("documents", "documentos")}</span>
            </div>
            <div>
              <strong>{pendingCount}</strong>
              <span>{ui("pending", "pendientes")}</span>
            </div>
            <div>
              <strong>{explainedCount}</strong>
              <span>{ui("explained", "explicados")}</span>
            </div>
            <div>
              <strong>{memoryCount}</strong>
              <span>{ui("memories", "memorias")}</span>
            </div>
            <div>
              <strong>{credentialCount}</strong>
              <span>{ui("credentials", "credenciales")}</span>
            </div>
          </section>

          <div className="workspace">
            <section>
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h2>{ui("Received Documents", "Documentos recibidos")}</h2>
                    <p>
                      {ui(
                        "Everything lands here after being saved as a raw document.",
                        "Todo entra aquí después de guardarse como raw document."
                      )}
                    </p>
                  </div>
                  <span className="status review">
                    {ui(`${pendingCount} to review`, `${pendingCount} por revisar`)}
                  </span>
                </div>
                <div className="inbox-tabs">
                  {[
                    ["all", ui("All", "Todo")],
                    ["memory", ui("Memory", "Memoria")],
                    ["credentials", ui("Credentials", "Credenciales")],
                    ["whatsapp", "WhatsApp"],
                    ["pending", ui("Pending", "Pendiente")],
                    ["received", ui("Received", "Recibido")],
                    ["extracted", ui("Extracted", "Extraído")],
                    ["explained", ui("Explained", "Explicado")],
                    ["disabled", ui("Do not search", "No buscar")],
                    ["failed", ui("Failed", "Falló")]
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={`chip ${filter === value ? "active" : ""}`}
                      onClick={() => setFilter(value as Filter)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="memory-list">
                  {isLoading ? <div className="empty-state">{ui("Loading documents...", "Cargando documentos...")}</div> : null}

                  {!isLoading && visibleDocuments.length === 0 ? (
                    <div className="empty-state">
                      <strong>{ui("No documents in this view.", "No hay documentos en esta vista.")}</strong>
                      <span>
                        {ui(
                          "Upload a document or screenshot to start the v1 flow.",
                          "Sube un documento o screenshot para empezar el flujo v1."
                        )}
                      </span>
                    </div>
                  ) : null}

                  {visibleDocuments.map((document) => (
                    <button
                      key={document.id}
                      className={`memory-item ${document.id === selectedId ? "selected" : ""}`}
                      onClick={() => setSelectedId(document.id)}
                    >
                      <div className={`memory-icon ${statusTone(document.status, document.review_status)}`}>
                        <Icon>{iconPaths.doc}</Icon>
                      </div>
                      <div>
                        <h3>{documentTitle(document, uiLanguage)}</h3>
                        <p>{documentMeta(document, uiLanguage)}</p>
                        <MemoryBadges document={document} language={uiLanguage} />
                      </div>
                      <span className={`status ${statusClass(document.status, document.review_status)}`}>
                        {statusLabel(document.status, document.review_status, uiLanguage)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <aside>
              <section className="panel detail">
                {selectedDocument ? (
                  <>
                    <div className="detail-head">
                      <span
                        className={`status ${statusClass(
                          selectedDocument.status,
                          selectedDocument.review_status
                        )}`}
                      >
                        {statusLabel(selectedDocument.status, selectedDocument.review_status, uiLanguage)}
                      </span>
                      <h2>{documentTitle(selectedDocument, uiLanguage)}</h2>
                      <p>{documentMeta(selectedDocument, uiLanguage)}</p>
                    </div>
                    <div className="detail-body">
                      <p className="summary">
                        {selectedDocument.explanations[0]?.body ??
                          ui(
                            "The document is already saved. Extraction and explanation still need to run.",
                            "El documento ya está guardado. Falta correr extracción y explicación."
                          )}
                      </p>
                      {hasSensitiveFacts(selectedDocument) ? (
                        <div className="sensitive-note">
                          <strong>{ui("Sensitive information detected", "Información sensible detectada")}</strong>
                          <span>
                            {selectedDocument.sensitive_info_locked
                              ? ui(
                                  "Enter the review password to reveal visible passwords, accounts, addresses, or codes.",
                                  "Ingresa la contraseña de revisión para revelar passwords, cuentas, direcciones o códigos visibles."
                                )
                              : ui(
                                  "Review visible passwords, accounts, addresses, or codes before approving and sending through WhatsApp.",
                                  "Revisa passwords, cuentas, direcciones o códigos visibles antes de aprobar y enviar por WhatsApp."
                                )}
                          </span>
                          {selectedDocument.sensitive_info_locked ? (
                            <form className="unlock-form" onSubmit={unlockSensitiveInfo}>
                              <input
                                type="password"
                                placeholder={ui("Review password", "Contraseña de revisión")}
                                value={unlockPassword}
                                onChange={(event) => setUnlockPassword(event.target.value)}
                                disabled={isUnlocking}
                              />
                              <button
                                className="small-button confirm"
                                type="submit"
                                disabled={isUnlocking || !unlockPassword.trim()}
                              >
                                {isUnlocking ? ui("Checking...", "Revisando...") : ui("Unlock", "Desbloquear")}
                              </button>
                            </form>
                          ) : null}
                          {unlockStatus ? <span>{unlockStatus}</span> : null}
                        </div>
                      ) : null}
                      <div className="fields">
                        <InfoField label="Source" value={selectedDocument.source} />
                        <InfoField label="Storage" value={selectedDocument.storage_path} />
                        <InfoField label="MIME" value={selectedDocument.mime_type ?? ui("Not detected", "No detectado")} />
                        <InfoField label="Facts" value={String(selectedDocument.facts.length)} />
                        <InfoField
                          label="Review"
                          value={reviewStatusLabel(selectedDocument.review_status, uiLanguage)}
                        />
                      </div>
                      <section className="memory-command">
                        <div className="memory-command-head">
                          <div>
                            <h3>{ui("Memory", "Memoria")}</h3>
                            <p>
                              {ui(
                                "How Ayudita uses this document when you ask through WhatsApp.",
                                "Cómo Ayudita usa este documento cuando preguntas por WhatsApp."
                              )}
                            </p>
                          </div>
                          <span className={`status ${selectedDocument.memory_disabled ? "review" : "ready"}`}>
                            {selectedDocument.memory_disabled ? ui("Do not search", "No buscar") : ui("Searchable", "Buscable")}
                          </span>
                        </div>
                        <div className="memory-command-grid">
                          <InfoField
                            label={ui("Labels", "Etiquetas")}
                            value={
                              selectedDocument.memory_aliases?.length
                                ? selectedDocument.memory_aliases.join(", ")
                                : ui("No label", "Sin etiqueta")
                            }
                          />
                          <InfoField
                            label={ui("Memory type", "Tipo memoria")}
                            value={
                              selectedDocument.has_credential_facts
                                ? ui("Credential", "Credencial")
                                : ui("Document", "Documento")
                            }
                          />
                          <InfoField
                            label={ui("Uses", "Usos")}
                            value={String(selectedDocument.memory_use_count ?? 0)}
                          />
                          <InfoField
                            label={ui("Source sent", "Fuente enviada")}
                            value={String(selectedDocument.source_request_count ?? 0)}
                          />
                        </div>
                        <p className="memory-hint">{memoryHint(selectedDocument, uiLanguage)}</p>
                      </section>
                      <div className="detail-actions">
                        <button
                          className="primary"
                          onClick={extractSelectedDocument}
                          disabled={isExtracting}
                        >
                          <Icon>{iconPaths.shield}</Icon>
                          {isExtracting ? ui("Extracting...", "Extrayendo...") : ui("Extract facts", "Extraer facts")}
                        </button>
                        <button className="secondary" onClick={() => refreshDocuments(selectedDocument.id)}>
                          {ui("Refresh", "Actualizar")}
                        </button>
                      </div>
                      {extractStatus ? <p className="inline-status">{extractStatus}</p> : null}
                      <div className="detail-actions stacked-actions">
                        <button
                          className="primary"
                          onClick={explainSelectedDocument}
                          disabled={isExplaining || selectedDocument.facts.length === 0}
                        >
                          <Icon>{iconPaths.send}</Icon>
                          {isExplaining ? ui("Generating...", "Generando...") : ui("Generate explanation", "Generar explicación")}
                        </button>
                        <button
                          className="secondary"
                          onClick={sendSelectedToWhatsApp}
                          disabled={isSending || !canSendWhatsApp(selectedDocument)}
                        >
                          {isSending ? ui("Sending...", "Enviando...") : ui("Send WhatsApp", "Enviar WhatsApp")}
                        </button>
                      </div>
                      {explainStatus ? <p className="inline-status">{explainStatus}</p> : null}
                      {sendStatus ? <p className="inline-status">{sendStatus}</p> : null}
                      <div className="review-actions">
                        <h3>{ui("Human review", "Revisión humana")}</h3>
                        <div className="review-action-grid">
                          <button
                            className="small-button confirm"
                            onClick={() => reviewSelectedDocument("approve")}
                            disabled={isReviewing || !selectedDocument.explanations.length}
                          >
                            {ui("Approve", "Aprobar")}
                          </button>
                          <button
                            className="small-button"
                            onClick={() => reviewSelectedDocument("flag")}
                            disabled={isReviewing}
                          >
                            {ui("Flag", "Marcar")}
                          </button>
                          <button
                            className="small-button"
                            onClick={() => reviewSelectedDocument("clearer_photo")}
                            disabled={isReviewing}
                          >
                            {ui("Ask for clear photo", "Pedir foto clara")}
                          </button>
                          <button
                            className="small-button"
                            onClick={() => reviewSelectedDocument("reset")}
                            disabled={isReviewing}
                          >
                            {ui("Back to pending", "Volver a pendiente")}
                          </button>
                        </div>
                        {reviewStatus ? <p className="inline-status">{reviewStatus}</p> : null}
                      </div>
                      {selectedDocument.facts.length ? (
                        <div className="evidence-list">
                          <h3>{ui("Extracted Facts", "Facts extraídos")}</h3>
                          {selectedDocument.facts.map((fact) => (
                            <div className="evidence-item" key={fact.id}>
                              <div>
                                <strong>{fact.label ?? fact.fact_type}</strong>
                                <span>{fact.provenance_type}</span>
                              </div>
                              <p>{fact.fact_value ?? ui("Not determined", "No determinado")}</p>
                              {fact.source_text ? <blockquote>{fact.source_text}</blockquote> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="detail-body">
                    <p className="summary">
                      {ui("Select or upload a document to see the detail.", "Selecciona o sube un documento para ver el detalle.")}
                    </p>
                  </div>
                )}
              </section>

              <section className="panel side-stack">
                <div className="panel-header">
                  <div>
                    <h2>{ui("Next Stage", "Próxima etapa")}</h2>
                    <p>{ui("Classification before explanation.", "Clasificación antes de explicación.")}</p>
                  </div>
                </div>
                <div className="review">
                  <div className="review-item">
                    <strong>{ui("Step 6: document type detector", "Step 6: detector de tipo de documento")}</strong>
                    <p>
                      {ui(
                        "Ayudita now classifies letters, screenshots, receipts, bills, and other documents before extracting facts. The explanation only uses what was saved.",
                        "Ayudita ahora clasifica cartas, screenshots, recibos, bills y otros documentos antes de extraer facts. La explicación solo usa lo que quedó guardado."
                      )}
                    </p>
                    <button className="small-button confirm">{ui("Active", "Activo")}</button>
                  </div>
                </div>
              </section>

              <section className="panel side-stack">
                <div className="panel-header">
                  <div>
                    <h2>WhatsApp</h2>
                    <p>{ui("The same flow can start from a WhatsApp photo.", "El mismo flujo entra por foto de WhatsApp.")}</p>
                  </div>
                </div>
                <div className="whatsapp-thread">
                  <div className="thread-row user">
                    <div className="bubble user">{ui("I am sending you a photo of the document.", "Te mando una foto del documento.")}</div>
                    <span className="thread-time">{ui("Input", "Entrada")}</span>
                  </div>
                  <div className="thread-row">
                    <div className="bubble ai">
                      {ui(
                        "I received your document. First I will save it safely, then I will review it with evidence.",
                        "Recibí tu documento. Primero lo guardaré seguro y luego lo revisaré con evidencia."
                      )}
                    </div>
                    <span className="thread-time">{ui("Future response", "Respuesta futura")}</span>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MemoryBadges({
  document,
  language
}: {
  document: DecoderDocumentSummary;
  language: UiLanguage;
}) {
  const badges: string[] = [];

  if (document.memory_aliases?.length) badges.push(...document.memory_aliases.slice(0, 2));
  if (document.has_credential_facts) badges.push(language === "es" ? "credencial" : "credential");
  if (document.memory_disabled) badges.push(language === "es" ? "no buscar" : "do not search");
  if (!badges.length) return null;

  return (
    <div className="memory-badges" aria-label={language === "es" ? "Memoria del documento" : "Document memory"}>
      {badges.map((badge) => (
        <span key={badge}>{badge}</span>
      ))}
    </div>
  );
}

function memoryHint(document: DecoderDocumentDetail, language: UiLanguage) {
  const isSpanish = language === "es";

  if (document.memory_disabled) {
    return isSpanish
      ? "Este documento está guardado, pero Ayudita no lo usará en búsquedas de memoria."
      : "This document is saved, but Ayudita will not use it in memory searches.";
  }

  if (document.memory_aliases?.length && document.has_credential_facts) {
    return isSpanish
      ? `Ayudita puede contestar preguntas de credenciales usando: ${document.memory_aliases.join(", ")}.`
      : `Ayudita can answer credential questions using: ${document.memory_aliases.join(", ")}.`;
  }

  if (document.memory_aliases?.length) {
    return isSpanish
      ? `Ayudita puede encontrar este documento por: ${document.memory_aliases.join(", ")}.`
      : `Ayudita can find this document by: ${document.memory_aliases.join(", ")}.`;
  }

  if (document.has_credential_facts) {
    return isSpanish
      ? "Este documento tiene credenciales detectadas, pero todavía no tiene una etiqueta de memoria."
      : "This document has credentials detected, but it does not have a memory label yet.";
  }

  return isSpanish
    ? "Este documento puede responder preguntas si coincide por tipo, fecha, texto extraído o contexto."
    : "This document can answer questions when type, date, extracted text, or context matches.";
}

function documentTitle(
  document: Pick<DecoderDocumentSummary, "document_type" | "document_category" | "storage_path">,
  language: UiLanguage
) {
  if (document.document_type) return document.document_type;
  if (document.document_category) return categoryLabel(document.document_category);
  const fileName = document.storage_path.split("/").pop() ?? (language === "es" ? "Documento" : "Document");
  return fileName.replace(/^\d+-[a-f0-9-]+-/i, "");
}

function categoryLabel(category: string) {
  return category
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function documentMeta(
  document: Pick<DecoderDocumentSummary, "source" | "mime_type" | "created_at"> & {
    facts_count?: number;
    facts?: unknown[];
  },
  language: UiLanguage
) {
  const date = new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(document.created_at));

  return `${sourceLabel(document.source)} · ${document.mime_type ?? (language === "es" ? "archivo" : "file")} · ${date} · ${
    document.facts_count ?? document.facts?.length ?? 0
  } facts`;
}

function sourceLabel(source: string) {
  return source === "whatsapp" ? "WhatsApp" : "Web";
}

function statusLabel(status: DocumentStatus, reviewStatus: ReviewStatus, language: UiLanguage) {
  const isSpanish = language === "es";

  if (reviewStatus === "flagged") return isSpanish ? "Marcado" : "Flagged";
  if (reviewStatus === "pending") return isSpanish ? "Revisar" : "Review";
  if (status === "received") return isSpanish ? "Recibido" : "Received";
  if (status === "extracted") return isSpanish ? "Extraído" : "Extracted";
  if (status === "explained") return isSpanish ? "Explicado" : "Explained";
  return isSpanish ? "Falló" : "Failed";
}

function reviewStatusLabel(reviewStatus: ReviewStatus, language: UiLanguage) {
  const isSpanish = language === "es";

  if (reviewStatus === "reviewed") return isSpanish ? "Revisado" : "Reviewed";
  if (reviewStatus === "flagged") return isSpanish ? "Marcado" : "Flagged";
  return isSpanish ? "Pendiente" : "Pending";
}

function reviewActionPendingLabel(action: ReviewAction, language: UiLanguage) {
  const isSpanish = language === "es";

  if (action === "approve") return isSpanish ? "Aprobando explicación..." : "Approving explanation...";
  if (action === "flag") return isSpanish ? "Marcando documento..." : "Flagging document...";
  if (action === "clearer_photo") {
    return isSpanish ? "Marcando para pedir foto mas clara..." : "Marking to request a clearer photo...";
  }
  return isSpanish ? "Volviendo a pendiente..." : "Moving back to pending...";
}

function reviewActionDoneLabel(action: ReviewAction, language: UiLanguage) {
  const isSpanish = language === "es";

  if (action === "approve") {
    return isSpanish
      ? "Aprobado. Listo para enviar cuando conectemos WhatsApp."
      : "Approved. Ready to send once WhatsApp is connected.";
  }
  if (action === "flag") return isSpanish ? "Marcado para revisión manual." : "Flagged for manual review.";
  if (action === "clearer_photo") {
    return isSpanish ? "Marcado para pedir una foto mas clara." : "Marked to request a clearer photo.";
  }
  return isSpanish ? "Documento volvió a pendiente." : "Document moved back to pending.";
}

function canSendWhatsApp(document: DecoderDocumentDetail) {
  return (
    document.source === "whatsapp" &&
    document.review_status === "reviewed" &&
    document.explanations.length > 0
  );
}

function hasSensitiveFacts(document: DecoderDocumentDetail) {
  return document.facts.some((fact) => {
    const text = `${fact.fact_type} ${fact.label ?? ""}`.toLowerCase();
    return (
      text.includes("credential") ||
      text.includes("password") ||
      text.includes("account") ||
      text.includes("address") ||
      text.includes("code") ||
      text.includes("token") ||
      text.includes("key")
    );
  });
}

function statusClass(status: DocumentStatus, reviewStatus: ReviewStatus) {
  if (reviewStatus === "flagged" || status === "failed") return "review";
  if (status === "explained" && reviewStatus === "reviewed") return "ready";
  if (status === "extracted" || status === "received") return "processing";
  return "review";
}

function statusTone(status: DocumentStatus, reviewStatus: ReviewStatus) {
  if (reviewStatus === "flagged" || status === "failed") return "red";
  if (status === "explained" && reviewStatus === "reviewed") return "green";
  return "blue";
}
