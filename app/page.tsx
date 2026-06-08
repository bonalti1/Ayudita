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

type Filter = "all" | "memory" | "credentials" | "whatsapp" | "drive" | "disabled" | DocumentStatus;
type UiLanguage = "en" | "es";
type ActiveView = "command" | "memory" | "documents";
type MemoryQueryResult = {
  answer: string | null;
  confidence: "high" | "medium" | "low" | "none";
  duplicate_source_count?: number;
  message?: string;
  document?: {
    id: string;
    title: string;
    source: string;
    mime_type: string | null;
    created_at: string;
    memory_aliases: string[];
    has_sensitive_info?: boolean;
    sensitive_info_locked?: boolean;
  };
  fact?: {
    label: string | null;
    fact_type: string;
    fact_value: string | null;
    source_text: string | null;
  } | null;
};
type TrustedAnswerGroup = {
  id: string;
  title: string;
  answer_label: string;
  answer_value: string | null;
  answer_source_text: string | null;
  confidence: "high" | "medium" | "low";
  aliases: string[];
  source_count: number;
  source_sent_count: number;
  memory_use_count: number;
  last_used_at: string | null;
  main_document_id: string;
  main_source_title: string;
  proof_type: "image" | "pdf" | "document";
  sources: Array<{
    document_id: string;
    title: string;
    created_at: string;
    mime_type: string | null;
    source: string;
    source_sent_count: number;
    memory_use_count: number;
    is_primary: boolean;
    is_main: boolean;
  }>;
};

type TrustedAnswerMemoryAction =
  | { action: "rename"; documentId: string; alias: string }
  | { action: "disable"; documentId: string; reason?: string }
  | { action: "set_primary"; documentId: string; trustedAnswerId: string };

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      {children}
    </svg>
  );
}

export default function Home() {
  const [documents, setDocuments] = useState<DecoderDocumentSummary[]>([]);
  const [trustedAnswers, setTrustedAnswers] = useState<TrustedAnswerGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<DecoderDocumentDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [activeView, setActiveView] = useState<ActiveView>("command");
  const [uploadStatus, setUploadStatus] = useState("");
  const [driveImportStatus, setDriveImportStatus] = useState("");
  const [memoryQuestion, setMemoryQuestion] = useState("What is my office WiFi password?");
  const [memoryAnswer, setMemoryAnswer] = useState<MemoryQueryResult | null>(null);
  const [memoryAskStatus, setMemoryAskStatus] = useState("");
  const [memoryManageStatus, setMemoryManageStatus] = useState("");
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("en");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockStatus, setUnlockStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isImportingDrive, setIsImportingDrive] = useState(false);
  const [isAskingMemory, setIsAskingMemory] = useState(false);
  const [isManagingMemory, setIsManagingMemory] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTrustedAnswersLoading, setIsTrustedAnswersLoading] = useState(true);
  const isSpanish = uiLanguage === "es";
  const ui = (english: string, spanish: string) => (isSpanish ? spanish : english);

  useEffect(() => {
    refreshDocuments();
    refreshTrustedAnswers();
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

  async function refreshTrustedAnswers() {
    setIsTrustedAnswersLoading(true);
    try {
      const response = await fetch("/api/trusted-answers");
      if (!response.ok) return;
      const data = (await response.json()) as { trusted_answers: TrustedAnswerGroup[] };
      setTrustedAnswers(data.trusted_answers);
    } finally {
      setIsTrustedAnswersLoading(false);
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

  async function manageTrustedAnswer(input: TrustedAnswerMemoryAction) {
    setIsManagingMemory(true);
    setMemoryManageStatus("");

    try {
      const response = await fetch(`/api/documents/${input.documentId}/memory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          input.action === "rename"
            ? { action: input.action, alias: input.alias }
            : input.action === "disable"
              ? { action: input.action, reason: input.reason }
              : { action: input.action, trustedAnswerId: input.trustedAnswerId }
        )
      });

      if (!response.ok) throw new Error("Memory update failed.");

      await Promise.all([refreshDocuments(input.documentId), refreshTrustedAnswers()]);
      setMemoryManageStatus(ui("Memory updated.", "Memoria actualizada."));
    } catch {
      setMemoryManageStatus(ui("Could not update memory.", "No se pudo actualizar la memoria."));
    } finally {
      setIsManagingMemory(false);
    }
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
      await refreshTrustedAnswers();
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
      setUploadStatus(ui("Source saved. Ayudita can remember it now.", "Fuente guardada. Ayudita ya la puede recordar."));
      await refreshDocuments(data.document.id);
      await refreshTrustedAnswers();
    } catch {
      setUploadStatus(ui("Could not upload the document.", "No se pudo subir el documento."));
    } finally {
      setIsUploading(false);
    }
  }

  async function importGoogleDriveFolder() {
    setIsImportingDrive(true);
    setDriveImportStatus(ui("Importing Google Drive folder...", "Importando carpeta de Google Drive..."));

    try {
      const response = await fetch("/api/drive/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 10, userPhone: "drive-import" })
      });
      const data = (await response.json().catch(() => null)) as {
        imported?: { documentId: string }[];
        skipped?: { reason: string }[];
        error?: string;
      } | null;

      if (!response.ok) {
        setDriveImportStatus(data?.error ?? ui("Could not import Google Drive.", "No se pudo importar Google Drive."));
        return;
      }

      const importedCount = data?.imported?.length ?? 0;
      const skippedCount = data?.skipped?.length ?? 0;
      setDriveImportStatus(
        ui(
          `Drive import complete: ${importedCount} new, ${skippedCount} skipped.`,
          `Importacion de Drive completa: ${importedCount} nuevos, ${skippedCount} omitidos.`
        )
      );
      await refreshDocuments(data?.imported?.[0]?.documentId);
      await refreshTrustedAnswers();
    } catch {
      setDriveImportStatus(ui("Could not import Google Drive.", "No se pudo importar Google Drive."));
    } finally {
      setIsImportingDrive(false);
    }
  }

  async function askMemory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = memoryQuestion.trim();
    if (!question) return;

    setIsAskingMemory(true);
    setMemoryAskStatus(ui("Searching saved memory...", "Buscando en memoria guardada..."));
    setMemoryAnswer(null);

    try {
      const response = await fetch("/api/memory-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });

      const data = (await response.json().catch(() => null)) as MemoryQueryResult & { error?: string } | null;

      if (!response.ok) {
        setMemoryAskStatus(data?.error ?? ui("Could not search memory.", "No se pudo buscar en memoria."));
        return;
      }

      setMemoryAnswer(data);
      setMemoryAskStatus("");
    } catch {
      setMemoryAskStatus(ui("Could not search memory.", "No se pudo buscar en memoria."));
    } finally {
      setIsAskingMemory(false);
    }
  }

  const memoryDocuments = useMemo(() => {
    return documents.filter(
      (document) =>
        hasUsefulMemoryAlias(document) ||
        Boolean(document.has_credential_facts) ||
        Boolean(document.memory_disabled)
    );
  }, [documents]);

  const recentDocuments = documents.slice(0, 5);
  const topTrustedAnswers = trustedAnswers.slice(0, 4);
  const disabledMemoryCount = documents.filter((document) => document.memory_disabled).length;
  const sourceUseCount = documents.reduce((total, document) => total + (document.source_request_count ?? 0), 0);

  const visibleDocuments = useMemo(() => {
    const viewDocuments = activeView === "memory" ? memoryDocuments : documents;

    if (activeView !== "documents") return viewDocuments;

    return viewDocuments.filter((document) => {
      if (filter === "all") return true;
      if (filter === "memory") return hasUsefulMemoryAlias(document) && !document.memory_disabled;
      if (filter === "credentials") return Boolean(document.has_credential_facts);
      if (filter === "whatsapp") return document.source === "whatsapp";
      if (filter === "drive") return document.source === "drive";
      if (filter === "disabled") return Boolean(document.memory_disabled);
      return document.status === filter;
    });
  }, [activeView, documents, filter, memoryDocuments]);

  const explainedCount = documents.filter((document) => document.status === "explained").length;
  const memoryCount = trustedAnswers.length;
  const credentialCount = documents.filter((document) => document.has_credential_facts).length;

  const viewTitle =
    activeView === "command"
      ? ui("Command Center", "Centro de mando")
      : activeView === "memory"
        ? ui("Memory Dashboard", "Dashboard de memoria")
        : ui("Document Library", "Biblioteca de documentos");

  const viewDescription =
    activeView === "command"
      ? ui(
          "Start here: what Ayudita remembers, where it came from, and how proof is available.",
          "Empieza aquí: qué recuerda Ayudita, de dónde vino y cómo está disponible la prueba."
        )
      : activeView === "memory"
        ? ui(
            "See what Ayudita can remember, where it came from, and whether it is searchable.",
            "Ve qué puede recordar Ayudita, de dónde vino y si se puede buscar."
          )
        : ui(
            "Browse the raw archive by source, type, status, and memory labels.",
            "Busca en el archivo original por fuente, tipo, estado y etiquetas de memoria."
          );

  const listTitle =
    activeView === "memory"
      ? ui("Known Memory", "Memoria conocida")
      : ui("Saved Source Library", "Biblioteca de fuentes guardadas");

  const listDescription =
    activeView === "memory"
      ? ui(
          "Credential facts, labels, disabled memories, and frequently used source material live here.",
          "Credenciales, etiquetas, memorias desactivadas y fuentes usadas viven aquí."
        )
      : ui(
          "Everything Ayudita can reference later lives here as the source of truth.",
          "Todo lo que Ayudita puede referenciar después vive aquí como fuente de verdad."
        );

  return (
    <div className="page">
      <aside className="sidebar">
        <div className="side-brand">
          <img src="/ayudita-red.png" alt="Ayudita" />
        </div>
        <nav className="nav" aria-label="Ayudita">
          <button className={activeView === "command" ? "active" : ""} onClick={() => setActiveView("command")}>
            <Icon>{iconPaths.home}</Icon>
            {ui("Command Center", "Centro de mando")}
          </button>
          <button className={activeView === "memory" ? "active" : ""} onClick={() => setActiveView("memory")}>
            <Icon>{iconPaths.doc}</Icon>
            {ui("Memory", "Memoria")}
          </button>
          <button className={activeView === "documents" ? "active" : ""} onClick={() => setActiveView("documents")}>
            <Icon>{iconPaths.inbox}</Icon>
            {ui("Documents", "Documentos")}
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
            <button className="icon-button" title={ui("Memory proof", "Prueba de memoria")} aria-label={ui("Memory proof", "Prueba de memoria")}>
              <Icon>{iconPaths.shield}</Icon>
            </button>
          </div>
        </header>

        <main className="main">
          <section className="intro">
            <div>
              <p className="eyebrow">Ayudita v1</p>
              <h1>{viewTitle}</h1>
              <p>{viewDescription}</p>
            </div>
            <div className="trust-note">
              <strong>{ui("Main rule", "Regla principal")}</strong>
              <span>
                {ui(
                  "The original document is the source of truth. Answers should only use saved facts with source text.",
                  "El documento original es la fuente de verdad. Las respuestas solo deben usar facts guardados con texto fuente."
                )}
              </span>
            </div>
          </section>

          <section className="ask-card upload-card" aria-label={ui("Upload document", "Subir documento")}>
            <div className="upload-copy">
              <Icon>{iconPaths.upload}</Icon>
              <div>
                <h2>{ui("Add source material", "Agregar fuentes")}</h2>
                <p>{ui("Upload one file or import the configured Google Drive folder.", "Sube un archivo o importa la carpeta configurada de Google Drive.")}</p>
              </div>
            </div>
            <div className="source-actions">
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
              <button className="secondary" type="button" onClick={importGoogleDriveFolder} disabled={isImportingDrive}>
                <Icon>{iconPaths.inbox}</Icon>
                {isImportingDrive ? ui("Importing...", "Importando...") : ui("Import Drive", "Importar Drive")}
              </button>
            </div>
            {uploadStatus ? <span className="upload-status">{uploadStatus}</span> : null}
            {driveImportStatus ? <span className="upload-status">{driveImportStatus}</span> : null}
          </section>

          <section className="ask-card memory-ask-card" aria-label={ui("Ask Ayudita memory", "Preguntar a memoria de Ayudita")}>
            <div className="ask-card-head">
              <div>
                <h2>{ui("Ask Ayudita Memory", "Preguntar a memoria de Ayudita")}</h2>
                <p>
                  {ui(
                    "Test the real experience: answer from memory first, then open the proof source.",
                    "Prueba la experiencia real: contestar desde memoria primero y luego abrir la fuente de prueba."
                  )}
                </p>
              </div>
              <span className="status ready">{ui("Proof-backed", "Con prueba")}</span>
            </div>
            <form className="ask-box" onSubmit={askMemory}>
              <Icon>{iconPaths.shield}</Icon>
              <input
                value={memoryQuestion}
                onChange={(event) => setMemoryQuestion(event.target.value)}
                placeholder={ui("Ask about a saved memory...", "Pregunta sobre una memoria guardada...")}
              />
              <button className="primary" type="submit" disabled={isAskingMemory || !memoryQuestion.trim()}>
                {isAskingMemory ? ui("Searching...", "Buscando...") : ui("Ask", "Preguntar")}
              </button>
            </form>
            <div className="chips" aria-label={ui("Example questions", "Preguntas ejemplo")}>
              {[
                ui("What is my office WiFi password?", "Cuál es mi password de WiFi de oficina?"),
                ui("Show me the proof source", "Muéstrame la fuente de prueba"),
                ui("What toll bill do I owe?", "Qué toll bill debo?")
              ].map((question) => (
                <button className="chip" key={question} onClick={() => setMemoryQuestion(question)}>
                  {question}
                </button>
              ))}
            </div>
            {memoryAskStatus ? <p className="inline-status">{memoryAskStatus}</p> : null}
            {memoryAnswer ? (
              <MemoryAnswerCard
                result={memoryAnswer}
                language={uiLanguage}
                onOpenSource={(documentId) => {
                  setActiveView("memory");
                  setSelectedId(documentId);
                }}
              />
            ) : null}
          </section>

          <section className="metric-strip" aria-label={ui("Decoder status", "Estado del decoder")}>
            <div>
              <strong>{documents.length}</strong>
              <span>{ui("documents", "documentos")}</span>
            </div>
            <div>
              <strong>{memoryCount}</strong>
              <span>{ui("trusted answers", "respuestas confiables")}</span>
            </div>
            <div>
              <strong>{explainedCount}</strong>
              <span>{ui("answer-ready", "listos para responder")}</span>
            </div>
            <div>
              <strong>{sourceUseCount}</strong>
              <span>{ui("proof sends", "pruebas enviadas")}</span>
            </div>
            <div>
              <strong>{credentialCount}</strong>
              <span>{ui("credentials", "credenciales")}</span>
            </div>
          </section>

          {activeView === "command" ? (
            <section className="command-layout" aria-label={ui("Command Center", "Centro de mando")}>
              <div className="command-main">
                <section className="panel command-panel">
                  <div className="panel-header">
                    <div>
                      <h2>{ui("What Ayudita Remembers", "Qué recuerda Ayudita")}</h2>
                      <p>
                        {ui(
                          "Customer-ready answers with proof, grouped from saved sources.",
                          "Respuestas listas para el cliente con prueba, agrupadas desde fuentes guardadas."
                        )}
                      </p>
                    </div>
                    <span className="status ready">{ui(`${trustedAnswers.length} trusted answers`, `${trustedAnswers.length} respuestas confiables`)}</span>
                  </div>
                  {memoryManageStatus ? <div className="memory-manage-status">{memoryManageStatus}</div> : null}
                  <div className="trusted-answer-list">
                    {isTrustedAnswersLoading ? <div className="empty-state">{ui("Loading trusted answers...", "Cargando respuestas confiables...")}</div> : null}
                    {!isTrustedAnswersLoading && topTrustedAnswers.length === 0 ? (
                      <div className="empty-state">
                        <strong>{ui("No trusted answers yet.", "Aún no hay respuestas confiables.")}</strong>
                        <span>
                          {ui(
                            "Upload a source or ask a question so Ayudita can turn documents into reusable answers.",
                            "Sube una fuente o haz una pregunta para que Ayudita convierta documentos en respuestas reutilizables."
                          )}
                        </span>
                      </div>
                    ) : null}
                    {topTrustedAnswers.map((answer) => (
                      <TrustedAnswerCard
                        key={answer.id}
                        answer={answer}
                        language={uiLanguage}
                        isManaging={isManagingMemory}
                        onManage={manageTrustedAnswer}
                        onOpenSource={(documentId) => {
                          setActiveView("memory");
                          setSelectedId(documentId);
                        }}
                      />
                    ))}
                  </div>
                </section>

                <SourceLabPanel
                  documents={documents}
                  language={uiLanguage}
                  isLoading={isLoading}
                  onOpenSource={(documentId) => {
                    setActiveView("documents");
                    setSelectedId(documentId);
                  }}
                />

                <section className="panel command-panel">
                  <div className="panel-header">
                    <div>
                      <h2>{ui("Recent Source Material", "Fuentes recientes")}</h2>
                      <p>
                        {ui(
                          "The newest raw documents Ayudita can use as proof.",
                          "Los documentos originales más recientes que Ayudita puede usar como prueba."
                        )}
                      </p>
                    </div>
                    <button className="small-button" onClick={() => setActiveView("documents")}>
                      {ui("Open library", "Abrir biblioteca")}
                    </button>
                  </div>
                  <div className="memory-list compact-list">
                    {!isLoading && recentDocuments.length === 0 ? (
                      <div className="empty-state">
                        <strong>{ui("No documents yet.", "Aún no hay documentos.")}</strong>
                        <span>{ui("Upload the first source above.", "Sube la primera fuente arriba.")}</span>
                      </div>
                    ) : null}
                    {recentDocuments.map((document) => (
                      <button
                        key={document.id}
                        className="memory-item"
                        onClick={() => {
                          setActiveView("documents");
                          setSelectedId(document.id);
                        }}
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
                </section>
              </div>

              <aside className="command-side">
                <section className="panel command-panel">
                  <div className="panel-header">
                    <div>
                      <h2>{ui("Source & Proof", "Fuente y prueba")}</h2>
                      <p>{ui("The health of saved sources and retrievable originals.", "La salud de fuentes guardadas y originales recuperables.")}</p>
                    </div>
                  </div>
                  <div className="command-stats">
                    <div>
                      <strong>{documents.length}</strong>
                      <span>{ui("saved sources", "fuentes guardadas")}</span>
                    </div>
                    <div>
                      <strong>{sourceUseCount}</strong>
                      <span>{ui("proof sends", "pruebas enviadas")}</span>
                    </div>
                    <div>
                      <strong>{memoryCount}</strong>
                      <span>{ui("trusted answers", "respuestas confiables")}</span>
                    </div>
                    <div>
                      <strong>{disabledMemoryCount}</strong>
                      <span>{ui("disabled memories", "memorias desactivadas")}</span>
                    </div>
                  </div>
                </section>

                <section className="panel command-panel">
                  <div className="panel-header">
                    <div>
                      <h2>{ui("Answer Experience", "Experiencia de respuesta")}</h2>
                      <p>
                        {ui(
                          "Best experience rule: answer fast, then guide the next move.",
                          "Regla de mejor experiencia: contestar rápido y guiar el siguiente paso."
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="trust-steps">
                    <div>
                      <strong>{ui("1. Answer simply", "1. Contestar simple")}</strong>
                      <span>{ui("Use 10th-grade language so the customer understands fast.", "Usar lenguaje simple para que el cliente entienda rápido.")}</span>
                    </div>
                    <div>
                      <strong>{ui("2. Keep proof one tap away", "2. Prueba a un toque")}</strong>
                      <span>{ui("The original image, PDF, or file stays available after the answer.", "La imagen, PDF o archivo original sigue disponible después de responder.")}</span>
                    </div>
                    <div>
                      <strong>{ui("3. Offer useful modes", "3. Ofrecer modos útiles")}</strong>
                      <span>{ui("Proof, Professional, and More detail turn one answer into a complete workflow.", "Prueba, Profesional y Mas detalle convierten una respuesta en un flujo completo.")}</span>
                    </div>
                  </div>
                  <AnswerModePreview language={uiLanguage} />
                </section>
              </aside>
            </section>
          ) : (
          <div className="workspace">
            <section>
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h2>{listTitle}</h2>
                    <p>{listDescription}</p>
                  </div>
                  <span className="status ready">
                    {activeView === "memory"
                      ? ui(`${memoryDocuments.length} memories`, `${memoryDocuments.length} memorias`)
                      : ui(`${documents.length} sources`, `${documents.length} fuentes`)}
                  </span>
                </div>
                {activeView === "documents" ? (
                  <div className="inbox-tabs">
                    {[
                      ["all", ui("All", "Todo")],
                      ["memory", ui("Memory", "Memoria")],
                      ["credentials", ui("Credentials", "Credenciales")],
                      ["whatsapp", "WhatsApp"],
                      ["drive", "Drive"],
                      ["received", ui("Saved", "Guardado")],
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
                ) : (
                  <div className="section-hint">
                    {ui("Only documents that affect memory show here.", "Aquí solo aparecen documentos que afectan la memoria.")}
                  </div>
                )}

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
                      <SourcePreview document={selectedDocument} language={uiLanguage} />
                      <p className="summary">
                        {selectedDocument.explanations[0]?.body ??
                          ui(
                            "This source is saved. Ayudita can use it later when a question matches its memory labels, facts, or source text.",
                            "Esta fuente está guardada. Ayudita la puede usar después cuando una pregunta coincida con sus etiquetas, facts o texto fuente."
                          )}
                      </p>
                      {hasSensitiveFacts(selectedDocument) ? (
                        <div className="sensitive-note">
                          <strong>{ui("Sensitive information detected", "Información sensible detectada")}</strong>
                          <span>
                            {selectedDocument.sensitive_info_locked
                              ? ui(
                                  "Enter the access password to reveal visible passwords, accounts, addresses, or codes.",
                                  "Ingresa la contraseña de acceso para revelar passwords, cuentas, direcciones o códigos visibles."
                                )
                              : ui(
                                  "Sensitive values are visible. Use them only as source-backed memory.",
                                  "Los valores sensibles están visibles. Úsalos solo como memoria respaldada por fuente."
                                )}
                          </span>
                          {selectedDocument.sensitive_info_locked ? (
                            <form className="unlock-form" onSubmit={unlockSensitiveInfo}>
                              <input
                                type="password"
                                placeholder={ui("Access password", "Contraseña de acceso")}
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
                        <InfoField
                          label={ui("Saved facts", "Facts guardados")}
                          value={String(selectedDocument.facts.length)}
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
                            label={ui("Last used", "Último uso")}
                            value={
                              selectedDocument.memory_last_used_at
                                ? shortDate(selectedDocument.memory_last_used_at, uiLanguage)
                                : ui("Not used yet", "Aún no usado")
                            }
                          />
                          <InfoField
                            label={ui("Source sent", "Fuente enviada")}
                            value={String(selectedDocument.source_request_count ?? 0)}
                          />
                        </div>
                        <p className="memory-hint">{memoryHint(selectedDocument, uiLanguage)}</p>
                      </section>
                      <DocumentSkillPanel document={selectedDocument} language={uiLanguage} />
                      <MemoryFactSummary document={selectedDocument} language={uiLanguage} />
                      <button className="secondary refresh-source" onClick={() => refreshDocuments(selectedDocument.id)}>
                        {ui("Refresh source", "Actualizar fuente")}
                      </button>
                      {selectedDocument.facts.length ? (
                        <div className="evidence-list">
                          <h3>{ui("Saved Facts", "Facts guardados")}</h3>
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
                    <h2>{ui("Best Answer Pattern", "Mejor patrón de respuesta")}</h2>
                    <p>{ui("Simple answer, proof, professional rewrite, or more detail.", "Respuesta simple, prueba, versión profesional o más detalle.")}</p>
                  </div>
                </div>
                <div className="trust-steps">
                  <div>
                    <strong>{ui("Answer simply", "Contestar simple")}</strong>
                    <span>{ui("Use the remembered fact when the match is clear.", "Usar el fact recordado cuando la coincidencia esté clara.")}</span>
                  </div>
                  <div>
                    <strong>{ui("Offer the action menu", "Ofrecer menú de acciones")}</strong>
                    <span>{ui("Proof, Professional, and More detail help the customer choose what they need next.", "Prueba, Profesional y Mas detalle ayudan al cliente a escoger lo que necesita después.")}</span>
                  </div>
                  <div>
                    <strong>{ui("Keep trust visible", "Mantener confianza visible")}</strong>
                    <span>{ui("The original source can always be sent back when the user wants confidence.", "La fuente original siempre se puede mandar cuando el usuario quiere confianza.")}</span>
                  </div>
                </div>
                <AnswerModePreview language={uiLanguage} />
              </section>

              <section className="panel side-stack">
                <div className="panel-header">
                  <div>
                    <h2>{ui("Example", "Ejemplo")}</h2>
                    <p>{ui("How it should feel in WhatsApp.", "Cómo debe sentirse en WhatsApp.")}</p>
                  </div>
                </div>
                <div className="whatsapp-thread">
                  <div className="thread-row user">
                    <div className="bubble user">{ui("What is my office WiFi password?", "Cuál es mi password de WiFi de oficina?")}</div>
                    <span className="thread-time">{ui("Question", "Pregunta")}</span>
                  </div>
                  <div className="thread-row">
                    <div className="bubble ai">
                      {ui(
                        "The office WiFi password is westswitch551. Source: Wi-Fi Settings Screenshot.",
                        "El password del WiFi de oficina es westswitch551. Fuente: Wi-Fi Settings Screenshot."
                      )}
                      <AnswerModePreview language={uiLanguage} compact />
                    </div>
                    <span className="thread-time">{ui("Trusted answer", "Respuesta confiable")}</span>
                  </div>
                </div>
              </section>
            </aside>
          </div>
          )}
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

function SourceLabPanel({
  documents,
  language,
  isLoading,
  onOpenSource
}: {
  documents: DecoderDocumentSummary[];
  language: UiLanguage;
  isLoading: boolean;
  onOpenSource: (documentId: string) => void;
}) {
  const isSpanish = language === "es";
  const labDocuments = documents.slice(0, 8);
  const rememberedCount = documents.filter(
    (document) => document.status === "extracted" || document.status === "explained"
  ).length;
  const stats = [
    {
      label: "Drive",
      value: documents.filter((document) => document.source === "drive").length
    },
    {
      label: "WhatsApp",
      value: documents.filter((document) => document.source === "whatsapp").length
    },
    {
      label: isSpanish ? "Uploads" : "Uploads",
      value: documents.filter((document) => document.source === "web").length
    },
    {
      label: isSpanish ? "Recordados" : "Remembered",
      value: rememberedCount
    }
  ];

  return (
    <section className="panel command-panel source-lab">
      <div className="panel-header">
        <div>
          <h2>{isSpanish ? "Source Lab" : "Source Lab"}</h2>
          <p>
            {isSpanish
              ? "Revisa que fuentes tiene Ayudita, que skill uso y que puede contestar."
              : "See what sources Ayudita has, which skill it used, and what it can answer."}
          </p>
        </div>
        <button className="small-button" onClick={() => onOpenSource(labDocuments[0]?.id ?? "")} disabled={!labDocuments.length}>
          {isSpanish ? "Abrir fuente" : "Open source"}
        </button>
      </div>
      <div className="source-lab-stats" aria-label={isSpanish ? "Salud de fuentes" : "Source health"}>
        {stats.map((stat) => (
          <div key={stat.label}>
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
      <div className="source-lab-list">
        {isLoading ? <div className="empty-state">{isSpanish ? "Cargando Source Lab..." : "Loading Source Lab..."}</div> : null}
        {!isLoading && !labDocuments.length ? (
          <div className="empty-state">
            <strong>{isSpanish ? "No hay fuentes todavia." : "No sources yet."}</strong>
            <span>{isSpanish ? "Sube un archivo o importa Drive para empezar." : "Upload a file or import Drive to start."}</span>
          </div>
        ) : null}
        {labDocuments.map((document) => {
          const skill = documentSkillProfile(document.document_category, isSpanish);
          const proofReady = document.facts_count > 0 || document.status === "explained";

          return (
            <button className="source-lab-row" key={document.id} onClick={() => onOpenSource(document.id)}>
              <div className={`memory-icon ${statusTone(document.status, document.review_status)}`}>
                <Icon>{iconPaths.doc}</Icon>
              </div>
              <div className="source-lab-copy">
                <div className="source-lab-title-row">
                  <h3>{documentTitle(document, language)}</h3>
                  <span>{sourceLabel(document.source)}</span>
                </div>
                <p>
                  {skill.title} · {document.facts_count} facts ·{" "}
                  {proofReady
                    ? isSpanish ? "prueba lista" : "proof ready"
                    : isSpanish ? "guardado primero" : "saved first"}
                </p>
                <div className="skill-question-list compact">
                  {skill.questions.slice(0, 3).map((question) => (
                    <span key={question}>{question}</span>
                  ))}
                </div>
              </div>
              <span className={`status ${statusClass(document.status, document.review_status)}`}>
                {statusLabel(document.status, document.review_status, language)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AnswerModePreview({ language, compact = false }: { language: UiLanguage; compact?: boolean }) {
  const isSpanish = language === "es";
  const modes = [
    {
      label: isSpanish ? "Prueba" : "Proof",
      detail: isSpanish ? "manda el original" : "send original"
    },
    {
      label: isSpanish ? "Profesional" : "Professional",
      detail: isSpanish ? "redacta para reenviar" : "rewrite to forward"
    },
    {
      label: isSpanish ? "Mas detalle" : "More detail",
      detail: isSpanish ? "explica mejor" : "explain more"
    }
  ];

  return (
    <div className={`answer-mode-preview ${compact ? "compact" : ""}`} aria-label={isSpanish ? "Modos de respuesta" : "Answer modes"}>
      {modes.map((mode) => (
        <div className="answer-mode-button" key={mode.label}>
          <strong>{mode.label}</strong>
          {!compact ? <span>{mode.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}

function TrustedAnswerCard({
  answer,
  language,
  isManaging,
  onManage,
  onOpenSource
}: {
  answer: TrustedAnswerGroup;
  language: UiLanguage;
  isManaging: boolean;
  onManage: (input: TrustedAnswerMemoryAction) => void;
  onOpenSource: (documentId: string) => void;
}) {
  const isSpanish = language === "es";
  const proofLabel =
    answer.proof_type === "image"
      ? isSpanish ? "imagen" : "image"
      : answer.proof_type === "pdf"
        ? "PDF"
        : isSpanish ? "documento" : "document";
  const sourceCountLabel = isSpanish
    ? `${answer.source_count} ${answer.source_count === 1 ? "fuente de prueba" : "fuentes de prueba"}`
    : `${answer.source_count} ${answer.source_count === 1 ? "proof source" : "proof sources"}`;
  const sourceSentLabel = isSpanish
    ? `${answer.source_sent_count} ${answer.source_sent_count === 1 ? "vez enviada" : "veces enviada"}`
    : `${answer.source_sent_count} ${answer.source_sent_count === 1 ? "source send" : "source sends"}`;
  const renameMemory = () => {
    const nextName = window.prompt(
      isSpanish ? "Nuevo nombre para esta memoria" : "New name for this memory",
      answer.title
    );
    const alias = nextName?.trim();
    if (!alias || alias === answer.title) return;
    onManage({ action: "rename", documentId: answer.main_document_id, alias });
  };
  const disableMemory = () => {
    const confirmed = window.confirm(
      isSpanish
        ? `Desactivar "${answer.title}" para que Ayudita no lo use como respuesta confiable?`
        : `Disable "${answer.title}" so Ayudita stops using it as a trusted answer?`
    );
    if (!confirmed) return;
    onManage({ action: "disable", documentId: answer.main_document_id, reason: "disabled_from_dashboard" });
  };

  return (
    <article className="trusted-answer-card">
      <div className="trusted-answer-main">
        <div className="memory-icon green">
          <Icon>{iconPaths.shield}</Icon>
        </div>
        <div>
          <div className="trusted-answer-title-row">
            <h3>{answer.title}</h3>
            <span className={`status ${answer.confidence === "low" ? "processing" : "ready"}`}>
              {answer.confidence === "high"
                ? isSpanish ? "Alta confianza" : "High confidence"
                : answer.confidence === "medium"
                  ? isSpanish ? "Confianza media" : "Medium confidence"
                  : isSpanish ? "Baja confianza" : "Low confidence"}
            </span>
          </div>
          <p>
            <strong>{answer.answer_label}</strong>
            {": "}
            {answer.answer_value ?? (isSpanish ? "Guardado con prueba" : "Saved with proof")}
          </p>
          <div className="trusted-answer-meta">
            <span>{sourceCountLabel}</span>
            <span>
              {isSpanish
                ? `Principal: ${answer.main_source_title}`
                : `Main: ${answer.main_source_title}`}
            </span>
            <span>{sourceSentLabel}</span>
          </div>
        </div>
      </div>
      {answer.sources.length > 1 ? (
        <div className="proof-source-strip">
          {answer.sources.slice(0, 3).map((source) => (
            <div className="proof-source-card" key={source.document_id}>
              <button className="proof-source-open" onClick={() => onOpenSource(source.document_id)}>
                {source.is_main
                  ? source.is_primary
                    ? isSpanish ? "Principal elegido" : "Chosen main"
                    : isSpanish ? "Principal" : "Main"
                  : isSpanish ? "Respaldo" : "Backup"}
                <span>{shortDate(source.created_at, language)}</span>
              </button>
              {!source.is_main ? (
                <button
                  className="proof-source-action"
                  disabled={isManaging}
                  onClick={() =>
                    onManage({
                      action: "set_primary",
                      documentId: source.document_id,
                      trustedAnswerId: answer.id
                    })
                  }
                >
                  {isSpanish ? "Hacer principal" : "Set main"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <div className="trusted-answer-actions">
        <span>
          {isSpanish
            ? `Prueba: ${proofLabel}. Último uso: ${answer.last_used_at ? shortDate(answer.last_used_at, language) : "aún no usado"}`
            : `Proof: ${proofLabel}. Last used: ${answer.last_used_at ? shortDate(answer.last_used_at, language) : "not used yet"}`}
        </span>
        <div className="trusted-answer-tools">
          <button className="small-button" disabled={isManaging} onClick={renameMemory}>
            {isSpanish ? "Renombrar" : "Rename"}
          </button>
          <button className="small-button danger" disabled={isManaging} onClick={disableMemory}>
            {isSpanish ? "Desactivar" : "Disable"}
          </button>
          <button className="small-button" onClick={() => onOpenSource(answer.main_document_id)}>
            {isSpanish ? "Abrir prueba" : "Open proof"}
          </button>
        </div>
      </div>
    </article>
  );
}

function MemoryAnswerCard({
  result,
  language,
  onOpenSource
}: {
  result: MemoryQueryResult;
  language: UiLanguage;
  onOpenSource: (documentId: string) => void;
}) {
  const isSpanish = language === "es";
  const hasAnswer = Boolean(result.answer);
  const confidenceLabel =
    result.confidence === "high"
      ? isSpanish ? "Alta confianza" : "High confidence"
      : result.confidence === "medium"
        ? isSpanish ? "Confianza media" : "Medium confidence"
        : result.confidence === "low"
          ? isSpanish ? "Baja confianza" : "Low confidence"
          : isSpanish ? "Sin match claro" : "No clear match";

  return (
    <div className={`memory-answer ${hasAnswer ? "" : "empty"}`}>
      <div className="memory-answer-head">
        <span className={`status ${result.confidence === "none" ? "review" : "ready"}`}>
          {confidenceLabel}
        </span>
        {result.duplicate_source_count && result.duplicate_source_count > 1 ? (
          <span className="duplicate-note">
            {isSpanish
              ? `${result.duplicate_source_count} fuentes dicen lo mismo`
              : `${result.duplicate_source_count} sources say the same thing`}
          </span>
        ) : null}
      </div>
      <p>{result.answer ?? result.message}</p>
      {result.fact ? (
        <div className="answer-fact">
          <span>{result.fact.label ?? result.fact.fact_type}</span>
          <strong>{result.fact.fact_value ?? (isSpanish ? "Guardado" : "Saved")}</strong>
        </div>
      ) : null}
      {result.document ? (
        <div className="answer-source">
          <div>
            <span>{isSpanish ? "Fuente" : "Source"}</span>
            <strong>{result.document.title}</strong>
          </div>
          <button className="small-button" onClick={() => onOpenSource(result.document!.id)}>
            {isSpanish ? "Abrir prueba" : "Open proof"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SourcePreview({
  document,
  language
}: {
  document: DecoderDocumentDetail;
  language: UiLanguage;
}) {
  const isSpanish = language === "es";
  const isImage = document.mime_type?.startsWith("image/");
  const isPdf = document.mime_type === "application/pdf";
  const title = documentTitle(document, language);

  if (document.sensitive_info_locked) {
    return (
      <div className="source-preview locked">
        <div className="source-preview-empty">
          <Icon>{iconPaths.shield}</Icon>
          <strong>{isSpanish ? "Vista previa bloqueada" : "Preview locked"}</strong>
          <span>
            {isSpanish
              ? "Esta fuente puede mostrar información sensible. Desbloquéala para ver la imagen o documento original."
              : "This source may show sensitive information. Unlock it to view the original image or document."}
          </span>
        </div>
      </div>
    );
  }

  if (document.source_url && isImage) {
    return (
      <figure className="source-preview" key={document.id}>
        <img key={document.source_url} src={document.source_url} alt={title} />
        <figcaption>
          {isSpanish ? "Imagen original guardada" : "Saved original image"}
        </figcaption>
      </figure>
    );
  }

  return (
    <div className="source-preview document-preview">
      <div className="source-preview-empty">
        <Icon>{iconPaths.doc}</Icon>
        <strong>
          {isPdf
            ? isSpanish
              ? "PDF original guardado"
              : "Saved original PDF"
            : isSpanish
              ? "Fuente original guardada"
              : "Saved original source"}
        </strong>
        <span>{document.storage_path}</span>
        {document.source_url ? (
          <a href={document.source_url} target="_blank" rel="noreferrer">
            {isSpanish ? "Abrir original" : "Open original"}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function MemoryFactSummary({
  document,
  language
}: {
  document: DecoderDocumentDetail;
  language: UiLanguage;
}) {
  const isSpanish = language === "es";
  const primaryFacts = document.facts
    .filter((fact) => fact.fact_value)
    .sort((a, b) => factImportance(b) - factImportance(a))
    .slice(0, 4);

  if (!primaryFacts.length) return null;

  return (
    <section className="memory-record">
      <div className="memory-record-head">
        <div>
          <h3>{isSpanish ? "Registro de memoria" : "Memory Record"}</h3>
          <p>
            {isSpanish
              ? "Lo que Ayudita puede contestar desde esta fuente."
              : "What Ayudita can answer from this source."}
          </p>
        </div>
        <span className="status ready">{isSpanish ? "Con prueba" : "Proof ready"}</span>
      </div>
      <div className="memory-record-grid">
        {primaryFacts.map((fact) => (
          <div className="memory-record-row" key={fact.id}>
            <span>{fact.label ?? fact.fact_type}</span>
            <strong>{fact.fact_value}</strong>
          </div>
        ))}
      </div>
      <div className="memory-record-footer">
        <span>{isSpanish ? "Fuente" : "Source"}</span>
        <strong>{documentTitle(document, language)}</strong>
        <span>{isSpanish ? "Prueba" : "Proof"}</span>
        <strong>{document.mime_type?.startsWith("image/") ? (isSpanish ? "Imagen original" : "Original image") : (isSpanish ? "Documento original" : "Original document")}</strong>
      </div>
    </section>
  );
}

function DocumentSkillPanel({
  document,
  language
}: {
  document: DecoderDocumentDetail;
  language: UiLanguage;
}) {
  const isSpanish = language === "es";
  const skill = documentSkillProfile(document.document_category, isSpanish);

  return (
    <section className="document-skill">
      <div className="document-skill-head">
        <div>
          <span>{isSpanish ? "Skill de documento" : "Document skill"}</span>
          <h3>{skill.title}</h3>
        </div>
        <strong>{skill.confidence}</strong>
      </div>
      <p>{skill.description}</p>
      <div className="skill-question-list">
        {skill.questions.map((question) => (
          <span key={question}>{question}</span>
        ))}
      </div>
    </section>
  );
}

function documentSkillProfile(category: string | null, isSpanish: boolean) {
  const key = category ?? "unclear";
  const profiles: Record<string, { title: string; description: string; questions: string[] }> = {
    contract: {
      title: isSpanish ? "Contrato" : "Contract",
      description: isSpanish
        ? "Busca clausulas, alcance, pagos, exclusiones, allowances, firmas y especificaciones."
        : "Looks for clauses, scope, payments, exclusions, allowances, signatures, and specifications.",
      questions: isSpanish
        ? ["Que incluye?", "Donde lo dice?", "Cuantos allowances hay?"]
        : ["What is included?", "Where does it say that?", "What allowances are listed?"]
    },
    blueprint_plan: {
      title: isSpanish ? "Planos / diseno" : "Blueprint / plan",
      description: isSpanish
        ? "Busca cuartos, dimensiones, sqft, notas de techo, materiales, hojas y revisiones."
        : "Looks for rooms, dimensions, square footage, ceiling notes, materials, sheets, and revisions.",
      questions: isSpanish
        ? ["Cuantos sqft muestra?", "Que notas de techo hay?", "Que cambio aparece?"]
        : ["How many square feet?", "What ceiling notes are shown?", "What changed?"]
    },
    wifi_settings: {
      title: isSpanish ? "WiFi / credencial" : "WiFi / credential",
      description: isSpanish
        ? "Busca nombre de red, password visible, router y contexto como oficina o casa."
        : "Looks for network name, visible password, router details, and home/office context.",
      questions: isSpanish
        ? ["Cual es el password?", "Cual es la red?", "Mandame la prueba"]
        : ["What is the password?", "What is the network?", "Send me the proof"]
    },
    bill_invoice: {
      title: isSpanish ? "Factura / bill" : "Invoice / bill",
      description: isSpanish
        ? "Busca proveedor, monto, fecha de vencimiento, estado de pago y numero de cuenta."
        : "Looks for vendor, amount, due date, payment status, and account or invoice number.",
      questions: isSpanish
        ? ["Cuanto se debe?", "Cuando vence?", "A quien se paga?"]
        : ["How much is due?", "When is it due?", "Who is it payable to?"]
    },
    receipt: {
      title: isSpanish ? "Recibo" : "Receipt",
      description: isSpanish
        ? "Busca tienda, monto pagado, fecha, metodo de pago y articulos visibles."
        : "Looks for store, paid amount, date, payment method, and visible items.",
      questions: isSpanish
        ? ["Cuanto se pago?", "Donde se compro?", "Que articulos salen?"]
        : ["How much was paid?", "Where was it purchased?", "What items are shown?"]
    },
    message_screenshot: {
      title: isSpanish ? "Screenshot de mensaje" : "Message screenshot",
      description: isSpanish
        ? "Busca nombres, fechas, decisiones, citas, direcciones, telefonos y pendientes."
        : "Looks for names, dates, decisions, appointments, addresses, phone numbers, and next steps.",
      questions: isSpanish
        ? ["Que se decidio?", "Quien lo dijo?", "Que fecha mencionan?"]
        : ["What was decided?", "Who said it?", "What date is mentioned?"]
    },
    identity_document: {
      title: isSpanish ? "Documento sensible" : "Sensitive document",
      description: isSpanish
        ? "Marca informacion personal sensible y mantiene la fuente protegida."
        : "Flags sensitive personal information and keeps the source protected.",
      questions: isSpanish
        ? ["Que datos muestra?", "Mandame la prueba", "Que no se pudo leer?"]
        : ["What details are shown?", "Send me the proof", "What could not be read?"]
    }
  };

  const fallback = {
    title: key === "unclear" ? (isSpanish ? "Documento general" : "General document") : categoryLabel(key),
    description: isSpanish
      ? "Ayudita usara texto visible, tipo, fecha y facts guardados para responder."
      : "Ayudita will use visible text, type, date, and saved facts to answer.",
    questions: isSpanish
      ? ["Que dice?", "Que datos importantes hay?", "Mandame la prueba"]
      : ["What does it say?", "What important details are there?", "Send me the proof"]
  };

  return {
    ...(profiles[key] ?? fallback),
    confidence: key === "unclear" ? (isSpanish ? "Revisar" : "Review") : (isSpanish ? "Activo" : "Active")
  };
}

function MemoryBadges({
  document,
  language
}: {
  document: DecoderDocumentSummary;
  language: UiLanguage;
}) {
  const badges: string[] = [];
  const aliases = usefulMemoryAliases(document.memory_aliases);

  if (aliases.length) badges.push(...aliases.slice(0, 2));
  if (document.document_category) badges.push(categoryLabel(document.document_category));
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
  const aliases = usefulMemoryAliases(document.memory_aliases);

  if (document.memory_disabled) {
    return isSpanish
      ? "Este documento está guardado, pero Ayudita no lo usará en búsquedas de memoria."
      : "This document is saved, but Ayudita will not use it in memory searches.";
  }

  if (aliases.length && document.has_credential_facts) {
    return isSpanish
      ? `Ayudita puede contestar preguntas de credenciales usando: ${aliases.join(", ")}.`
      : `Ayudita can answer credential questions using: ${aliases.join(", ")}.`;
  }

  if (aliases.length) {
    return isSpanish
      ? `Ayudita puede encontrar este documento por: ${aliases.join(", ")}.`
      : `Ayudita can find this document by: ${aliases.join(", ")}.`;
  }

  if (document.has_credential_facts) {
    return isSpanish
      ? "Este documento tiene credenciales detectadas, pero todavía no tiene una etiqueta de memoria."
      : "This document has credentials detected, but it does not have a memory label yet.";
  }

  return isSpanish
    ? "Este documento puede responder preguntas si coincide por tipo, fecha, texto guardado o contexto."
    : "This document can answer questions when type, date, saved text, or context matches.";
}

function hasUsefulMemoryAlias(document: Pick<DecoderDocumentSummary, "memory_aliases">) {
  return usefulMemoryAliases(document.memory_aliases).length > 0;
}

function usefulMemoryAliases(aliases?: string[]) {
  return (aliases ?? []).filter(isUsefulMemoryAlias);
}

function isUsefulMemoryAlias(value: string) {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, " ")
    .trim();

  if (!normalized) return false;
  if (["yes", "no", "ok", "okay", "thanks", "thank you", "mine", "me", "my"].includes(normalized)) {
    return false;
  }
  return normalized.length >= 4;
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

function shortDate(date: string, language: UiLanguage) {
  return new Intl.DateTimeFormat(language === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(date));
}

function factImportance(fact: { fact_type: string; label: string | null }) {
  const text = `${fact.fact_type} ${fact.label ?? ""}`.toLowerCase();
  if (text.includes("password") || text.includes("credential")) return 8;
  if (text.includes("amount") || text.includes("due")) return 6;
  if (text.includes("name") || text.includes("account")) return 5;
  return 1;
}

function sourceLabel(source: string) {
  if (source === "whatsapp") return "WhatsApp";
  if (source === "drive") return "Drive";
  return "Web";
}

function statusLabel(status: DocumentStatus, _reviewStatus: ReviewStatus, language: UiLanguage) {
  const isSpanish = language === "es";

  if (status === "received") return isSpanish ? "Guardado" : "Saved";
  if (status === "extracted") return isSpanish ? "Recordado" : "Remembered";
  if (status === "explained") return isSpanish ? "Listo" : "Ready";
  return isSpanish ? "Falló" : "Failed";
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
