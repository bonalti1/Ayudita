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

type Filter = "all" | "pending" | DocumentStatus;
type ReviewAction = "approve" | "flag" | "clearer_photo" | "reset";

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
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

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
  }

  async function uploadDocument(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    setIsUploading(true);
    setUploadStatus("Guardando el documento original...");

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
        setUploadStatus(data?.error ?? "No se pudo subir el documento.");
        return;
      }

      const data = (await response.json()) as { document: DecoderDocumentSummary };
      setUploadStatus("Documento guardado. Listo para extracción.");
      await refreshDocuments(data.document.id);
    } catch {
      setUploadStatus("No se pudo subir el documento.");
    } finally {
      setIsUploading(false);
    }
  }

  async function extractSelectedDocument() {
    if (!selectedId) return;

    setIsExtracting(true);
    setExtractStatus("Extrayendo facts con evidencia...");

    try {
      const response = await fetch(`/api/documents/${selectedId}/extract`, {
        method: "POST"
      });

      const data = (await response.json().catch(() => null)) as
        | { document?: DecoderDocumentDetail; error?: string }
        | null;

      if (!response.ok || !data?.document) {
        setExtractStatus(data?.error ?? "No se pudo extraer el documento.");
        return;
      }

      setSelectedDocument(data.document);
      setExtractStatus("Facts extraídos y guardados.");
      await refreshDocuments(data.document.id);
    } catch {
      setExtractStatus("No se pudo extraer el documento.");
    } finally {
      setIsExtracting(false);
    }
  }

  async function explainSelectedDocument() {
    if (!selectedId) return;

    setIsExplaining(true);
    setExplainStatus("Generando explicación en español...");

    try {
      const response = await fetch(`/api/documents/${selectedId}/explain`, {
        method: "POST"
      });

      const data = (await response.json().catch(() => null)) as
        | { document?: DecoderDocumentDetail; error?: string }
        | null;

      if (!response.ok || !data?.document) {
        setExplainStatus(data?.error ?? "No se pudo generar la explicación.");
        return;
      }

      setSelectedDocument(data.document);
      setExplainStatus("Explicación generada. Falta revisión humana.");
      await refreshDocuments(data.document.id);
    } catch {
      setExplainStatus("No se pudo generar la explicación.");
    } finally {
      setIsExplaining(false);
    }
  }

  async function reviewSelectedDocument(action: ReviewAction) {
    if (!selectedId) return;

    setIsReviewing(true);
    setReviewStatus(reviewActionPendingLabel(action));

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
        setReviewStatus(data?.error ?? "No se pudo actualizar la revisión.");
        return;
      }

      setSelectedDocument(data.document);
      setReviewStatus(reviewActionDoneLabel(action));
      await refreshDocuments(data.document.id);
    } catch {
      setReviewStatus("No se pudo actualizar la revisión.");
    } finally {
      setIsReviewing(false);
    }
  }

  async function sendSelectedToWhatsApp() {
    if (!selectedId) return;

    setIsSending(true);
    setSendStatus("Enviando explicación por WhatsApp...");

    try {
      const response = await fetch(`/api/documents/${selectedId}/send-whatsapp`, {
        method: "POST"
      });

      const data = (await response.json().catch(() => null)) as
        | { document?: DecoderDocumentDetail; error?: string }
        | null;

      if (!response.ok || !data?.document) {
        setSendStatus(data?.error ?? "No se pudo enviar por WhatsApp.");
        return;
      }

      setSelectedDocument(data.document);
      setSendStatus("Explicación enviada por WhatsApp.");
      await refreshDocuments(data.document.id);
    } catch {
      setSendStatus("No se pudo enviar por WhatsApp.");
    } finally {
      setIsSending(false);
    }
  }

  const visibleDocuments = useMemo(() => {
    return documents.filter((document) => {
      if (filter === "all") return true;
      if (filter === "pending") return document.review_status === "pending";
      return document.status === filter;
    });
  }, [documents, filter]);

  const pendingCount = documents.filter((document) => document.review_status === "pending").length;
  const explainedCount = documents.filter((document) => document.status === "explained").length;

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
            Documentos
          </button>
          <button>
            <Icon>{iconPaths.shield}</Icon>
            Revisión
          </button>
        </nav>
        <div className="side-status">
          <strong>
            <span className="dot" /> Raw-first activo
          </strong>
          <p>Cada archivo se guarda en Storage antes de cualquier lectura con AI.</p>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <div className="brand">
            <span className="connection">
              <span className="dot" /> Supabase conectado
            </span>
          </div>
          <button className="icon-button" title="Revisión pendiente" aria-label="Revisión pendiente">
            <Icon>{iconPaths.shield}</Icon>
          </button>
        </header>

        <main className="main">
          <section className="intro">
            <div>
              <p className="eyebrow">Decoder v1</p>
              <h1>Explica una carta con evidencia, sin inventar.</h1>
              <p>
                Sube una foto o PDF. Ayudita guarda el original primero y lo pone en cola para
                extraer facts, generar explicación en español y revisar antes de responder.
              </p>
            </div>
            <div className="trust-note">
              <strong>Regla principal</strong>
              <span>
                El documento original es la fuente de verdad. La explicación solo debe hablar de
                facts extraídos con texto fuente.
              </span>
            </div>
          </section>

          <section className="ask-card upload-card" aria-label="Subir documento">
            <div className="upload-copy">
              <Icon>{iconPaths.upload}</Icon>
              <div>
                <h2>Subir documento</h2>
                <p>JPG, PNG, WebP o PDF. Máximo 20 MB.</p>
              </div>
            </div>
            <label className={`primary upload-button ${isUploading ? "disabled" : ""}`}>
              <Icon>{iconPaths.upload}</Icon>
              {isUploading ? "Subiendo..." : "Elegir archivo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={uploadDocument}
                disabled={isUploading}
              />
            </label>
            {uploadStatus ? <span className="upload-status">{uploadStatus}</span> : null}
          </section>

          <section className="metric-strip" aria-label="Estado del decoder">
            <div>
              <strong>{documents.length}</strong>
              <span>documentos</span>
            </div>
            <div>
              <strong>{pendingCount}</strong>
              <span>pendientes</span>
            </div>
            <div>
              <strong>{explainedCount}</strong>
              <span>explicados</span>
            </div>
          </section>

          <div className="workspace">
            <section>
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h2>Documentos recibidos</h2>
                    <p>Todo entra aquí después de guardarse como raw document.</p>
                  </div>
                  <span className="status review">{pendingCount} por revisar</span>
                </div>
                <div className="inbox-tabs">
                  {[
                    ["all", "Todo"],
                    ["pending", "Pendiente"],
                    ["received", "Recibido"],
                    ["extracted", "Extraído"],
                    ["explained", "Explicado"],
                    ["failed", "Falló"]
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
                  {isLoading ? <div className="empty-state">Cargando documentos...</div> : null}

                  {!isLoading && visibleDocuments.length === 0 ? (
                    <div className="empty-state">
                      <strong>No hay documentos en esta vista.</strong>
                      <span>Sube una carta para empezar el flujo v1.</span>
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
                        <h3>{documentTitle(document)}</h3>
                        <p>{documentMeta(document)}</p>
                      </div>
                      <span className={`status ${statusClass(document.status, document.review_status)}`}>
                        {statusLabel(document.status, document.review_status)}
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
                        {statusLabel(selectedDocument.status, selectedDocument.review_status)}
                      </span>
                      <h2>{documentTitle(selectedDocument)}</h2>
                      <p>{documentMeta(selectedDocument)}</p>
                    </div>
                    <div className="detail-body">
                      <p className="summary">
                        {selectedDocument.explanations[0]?.body ??
                          "El documento ya está guardado. Falta correr extracción y explicación."}
                      </p>
                      <div className="fields">
                        <InfoField label="Source" value={selectedDocument.source} />
                        <InfoField label="Storage" value={selectedDocument.storage_path} />
                        <InfoField label="MIME" value={selectedDocument.mime_type ?? "No detectado"} />
                        <InfoField label="Facts" value={String(selectedDocument.facts.length)} />
                        <InfoField
                          label="Review"
                          value={reviewStatusLabel(selectedDocument.review_status)}
                        />
                      </div>
                      <div className="detail-actions">
                        <button
                          className="primary"
                          onClick={extractSelectedDocument}
                          disabled={isExtracting}
                        >
                          <Icon>{iconPaths.shield}</Icon>
                          {isExtracting ? "Extrayendo..." : "Extraer facts"}
                        </button>
                        <button className="secondary" onClick={() => refreshDocuments(selectedDocument.id)}>
                          Actualizar
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
                          {isExplaining ? "Generando..." : "Generar explicación"}
                        </button>
                        <button
                          className="secondary"
                          onClick={sendSelectedToWhatsApp}
                          disabled={isSending || !canSendWhatsApp(selectedDocument)}
                        >
                          {isSending ? "Enviando..." : "Enviar WhatsApp"}
                        </button>
                      </div>
                      {explainStatus ? <p className="inline-status">{explainStatus}</p> : null}
                      {sendStatus ? <p className="inline-status">{sendStatus}</p> : null}
                      <div className="review-actions">
                        <h3>Revisión humana</h3>
                        <div className="review-action-grid">
                          <button
                            className="small-button confirm"
                            onClick={() => reviewSelectedDocument("approve")}
                            disabled={isReviewing || !selectedDocument.explanations.length}
                          >
                            Aprobar
                          </button>
                          <button
                            className="small-button"
                            onClick={() => reviewSelectedDocument("flag")}
                            disabled={isReviewing}
                          >
                            Marcar
                          </button>
                          <button
                            className="small-button"
                            onClick={() => reviewSelectedDocument("clearer_photo")}
                            disabled={isReviewing}
                          >
                            Pedir foto clara
                          </button>
                          <button
                            className="small-button"
                            onClick={() => reviewSelectedDocument("reset")}
                            disabled={isReviewing}
                          >
                            Volver a pendiente
                          </button>
                        </div>
                        {reviewStatus ? <p className="inline-status">{reviewStatus}</p> : null}
                      </div>
                      {selectedDocument.facts.length ? (
                        <div className="evidence-list">
                          <h3>Facts extraídos</h3>
                          {selectedDocument.facts.map((fact) => (
                            <div className="evidence-item" key={fact.id}>
                              <div>
                                <strong>{fact.label ?? fact.fact_type}</strong>
                                <span>{fact.provenance_type}</span>
                              </div>
                              <p>{fact.fact_value ?? "No determinado"}</p>
                              {fact.source_text ? <blockquote>{fact.source_text}</blockquote> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="detail-body">
                    <p className="summary">Selecciona o sube un documento para ver el detalle.</p>
                  </div>
                )}
              </section>

              <section className="panel side-stack">
                <div className="panel-header">
                  <div>
                    <h2>Próxima etapa</h2>
                    <p>Extracción separada de explicación.</p>
                  </div>
                </div>
                <div className="review">
                  <div className="review-item">
                    <strong>Step 5: explicación con facts solamente</strong>
                    <p>
                      Ahora el reviewer puede aprobar, marcar o pedir una foto mas clara. Aprobar
                      solo deja listo para enviar; WhatsApp se conecta en el siguiente paso.
                    </p>
                    <button className="small-button confirm">Activo</button>
                  </div>
                </div>
              </section>

              <section className="panel side-stack">
                <div className="panel-header">
                  <div>
                    <h2>WhatsApp</h2>
                    <p>El mismo flujo entrará por foto de WhatsApp.</p>
                  </div>
                </div>
                <div className="whatsapp-thread">
                  <div className="thread-row user">
                    <div className="bubble user">Te mando una foto de la carta.</div>
                    <span className="thread-time">Entrada</span>
                  </div>
                  <div className="thread-row">
                    <div className="bubble ai">
                      Recibí tu documento. Primero lo guardaré seguro y luego lo revisaré con
                      evidencia.
                    </div>
                    <span className="thread-time">Respuesta futura</span>
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

function documentTitle(document: Pick<DecoderDocumentSummary, "document_type" | "storage_path">) {
  if (document.document_type) return document.document_type;
  const fileName = document.storage_path.split("/").pop() ?? "Documento";
  return fileName.replace(/^\d+-[a-f0-9-]+-/i, "");
}

function documentMeta(
  document: Pick<DecoderDocumentSummary, "source" | "mime_type" | "created_at"> & {
    facts_count?: number;
    facts?: unknown[];
  }
) {
  const date = new Intl.DateTimeFormat("es-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(document.created_at));

  return `${sourceLabel(document.source)} · ${document.mime_type ?? "archivo"} · ${date} · ${
    document.facts_count ?? document.facts?.length ?? 0
  } facts`;
}

function sourceLabel(source: string) {
  return source === "whatsapp" ? "WhatsApp" : "Web";
}

function statusLabel(status: DocumentStatus, reviewStatus: ReviewStatus) {
  if (reviewStatus === "flagged") return "Marcado";
  if (reviewStatus === "pending") return "Revisar";
  if (status === "received") return "Recibido";
  if (status === "extracted") return "Extraído";
  if (status === "explained") return "Explicado";
  return "Falló";
}

function reviewStatusLabel(reviewStatus: ReviewStatus) {
  if (reviewStatus === "reviewed") return "Revisado";
  if (reviewStatus === "flagged") return "Marcado";
  return "Pendiente";
}

function reviewActionPendingLabel(action: ReviewAction) {
  if (action === "approve") return "Aprobando explicación...";
  if (action === "flag") return "Marcando documento...";
  if (action === "clearer_photo") return "Marcando para pedir foto mas clara...";
  return "Volviendo a pendiente...";
}

function reviewActionDoneLabel(action: ReviewAction) {
  if (action === "approve") return "Aprobado. Listo para enviar cuando conectemos WhatsApp.";
  if (action === "flag") return "Marcado para revisión manual.";
  if (action === "clearer_photo") return "Marcado para pedir una foto mas clara.";
  return "Documento volvió a pendiente.";
}

function canSendWhatsApp(document: DecoderDocumentDetail) {
  return (
    document.source === "whatsapp" &&
    document.review_status === "reviewed" &&
    document.explanations.length > 0
  );
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
