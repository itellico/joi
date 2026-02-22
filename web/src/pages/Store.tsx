import { useEffect, useState, useCallback, useRef } from "react";
import {
  Badge,
  Button,
  EmptyState,
  MetaText,
  Modal,
  PageHeader,
  PageBody,
  SearchInput,
  SectionLabel,
} from "../components/ui";

interface Collection {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  schema: SchemaField[];
  config: Record<string, unknown>;
  object_count: number;
  created_at: string;
  updated_at: string;
}

interface SchemaField {
  name: string;
  type: string;
  required?: boolean;
  options?: string[];
}

interface StoreObject {
  id: string;
  collection_id: string;
  title: string;
  data: Record<string, unknown>;
  tags: string[];
  status: string;
  semantic_status?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  collection_name: string;
  collection_icon: string | null;
}

interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  metadata: Record<string, unknown>;
  source_title: string;
  source_collection: string;
  target_title: string;
  target_collection: string;
  created_at: string;
}

interface StoreStats {
  collections: number;
  objects: number;
  relations: number;
}

interface ObjectDetail {
  object: StoreObject & { collection_schema: SchemaField[] };
  relations: Relation[];
}

const FIELD_TYPES = ["text", "number", "date", "select", "multi_select", "checkbox", "url", "email", "json"];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// ─── Field Input component ───
function FieldInput({
  field, value, onChange,
}: {
  field: SchemaField;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === "select" && field.options) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className="store-input">
        <option value="">--</option>
        {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    );
  }
  if (field.type === "checkbox") {
    return (
      <label className="store-checkbox-label">
        <input
          type="checkbox" checked={value === "true"}
          onChange={(e) => onChange(String(e.target.checked))}
        />
        {value === "true" ? "Yes" : "No"}
      </label>
    );
  }
  if (field.type === "multi_select" && field.options) {
    const selected = value ? value.split(",").map((s) => s.trim()) : [];
    return (
      <div className="flex-row flex-wrap gap-1">
        {field.options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              onClick={() => {
                const next = active ? selected.filter((s) => s !== opt) : [...selected, opt];
                onChange(next.join(", "));
              }}
              className={`store-multi-select-btn${active ? " active" : ""}`}
            >{opt}</button>
          );
        })}
      </div>
    );
  }
  return (
    <input
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.type === "url" ? "https://..." : field.type === "email" ? "name@example.com" : ""}
      className="store-input"
    />
  );
}

// ─── Collection context menu ───
function CollectionMenu({
  collection, position, onClose, onRename, onEditSchema, onDelete,
}: {
  collection: Collection;
  position: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onEditSchema: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="store-context-menu"
      style={{ left: position.x, top: position.y }}
    >
      <div className="store-context-menu-header">
        {collection.icon} {collection.name}
      </div>
      <div className="store-context-menu-item" onClick={() => { onRename(); onClose(); }}>
        Rename
      </div>
      <div className="store-context-menu-item" onClick={() => { onEditSchema(); onClose(); }}>
        Edit Schema
      </div>
      <div className="store-context-menu-item danger" onClick={() => { onDelete(); onClose(); }}>
        Delete Collection
      </div>
    </div>
  );
}

// ─── Main Store component ───
export default function Store() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [objects, setObjects] = useState<StoreObject[]>([]);
  const [totalObjects, setTotalObjects] = useState(0);
  const [stats, setStats] = useState<StoreStats>({ collections: 0, objects: 0, relations: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<StoreObject[] | null>(null);
  const [selectedObject, setSelectedObject] = useState<ObjectDetail | null>(null);
  const [showOutdatedFacts, setShowOutdatedFacts] = useState(false);

  // Modals
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [showNewObject, setShowNewObject] = useState(false);
  const [showEditSchema, setShowEditSchema] = useState<Collection | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Collection | null>(null);

  // Collection context menu
  const [collMenu, setCollMenu] = useState<{ collection: Collection; x: number; y: number } | null>(null);

  // Inline rename
  const [renamingCollId, setRenamingCollId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);

  // New collection form
  const [newCollName, setNewCollName] = useState("");
  const [newCollDesc, setNewCollDesc] = useState("");
  const [newCollIcon, setNewCollIcon] = useState("");
  const [newCollFields, setNewCollFields] = useState<SchemaField[]>([{ name: "", type: "text" }]);

  // New object form
  const [newObjTitle, setNewObjTitle] = useState("");
  const [newObjData, setNewObjData] = useState<Record<string, string>>({});
  const [newObjTags, setNewObjTags] = useState("");

  // Edit object state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editData, setEditData] = useState<Record<string, string>>({});
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit schema form
  const [editSchemaFields, setEditSchemaFields] = useState<SchemaField[]>([]);

  // ─── Data fetching ───

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch("/api/store/collections");
      const data = await res.json();
      setCollections(data.collections || []);
    } catch (err) {
      console.error("Failed to load collections:", err);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/store/stats");
      const data = await res.json();
      setStats(data);
    } catch { /* ignore */ }
  }, []);

  const fetchObjects = useCallback(async (collectionId?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (collectionId) params.set("collection", collectionId);
      if (showOutdatedFacts) params.set("fact_state", "all");
      const res = await fetch(`/api/store/objects?${params}`);
      const data = await res.json();
      setObjects(data.objects || []);
      setTotalObjects(data.total || 0);
    } catch (err) {
      console.error("Failed to load objects:", err);
    } finally {
      setLoading(false);
    }
  }, [showOutdatedFacts]);

  const fetchObjectDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/store/objects/${id}`);
      const data = await res.json();
      setSelectedObject(data);
      setEditing(false);
    } catch (err) {
      console.error("Failed to load object:", err);
    }
  }, []);

  useEffect(() => {
    fetchCollections();
    fetchStats();
  }, [fetchCollections, fetchStats]);

  useEffect(() => {
    setSearchResults(null);
    setSelectedObject(null);
    fetchObjects(selectedCollection || undefined);
  }, [selectedCollection, fetchObjects]);

  // Focus rename input
  useEffect(() => {
    if (renamingCollId && renameRef.current) renameRef.current.focus();
  }, [renamingCollId]);

  // ─── Search ───

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    try {
      const res = await fetch("/api/store/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: searchQuery,
          collection: selectedCollection || undefined,
          limit: 50,
          fact_state: showOutdatedFacts ? "all" : "non_outdated",
        }),
      });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error("Search failed:", err);
    }
  };

  // ─── Collection CRUD ───

  const handleCreateCollection = async () => {
    if (!newCollName.trim() || newCollFields.some((f) => !f.name.trim())) return;
    try {
      await fetch("/api/store/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCollName, description: newCollDesc || undefined,
          icon: newCollIcon || undefined, schema: newCollFields.filter((f) => f.name.trim()),
        }),
      });
      setShowNewCollection(false);
      resetNewCollForm();
      fetchCollections();
      fetchStats();
    } catch (err) {
      console.error("Failed to create collection:", err);
    }
  };

  const resetNewCollForm = () => {
    setNewCollName(""); setNewCollDesc(""); setNewCollIcon("");
    setNewCollFields([{ name: "", type: "text" }]);
  };

  const handleRenameCollection = async (id: string, name: string) => {
    if (!name.trim()) { setRenamingCollId(null); return; }
    try {
      await fetch(`/api/store/collections/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setRenamingCollId(null);
      fetchCollections();
    } catch (err) {
      console.error("Rename failed:", err);
    }
  };

  const handleUpdateSchema = async () => {
    if (!showEditSchema) return;
    try {
      await fetch(`/api/store/collections/${showEditSchema.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schema: editSchemaFields.filter((f) => f.name.trim()) }),
      });
      setShowEditSchema(null);
      fetchCollections();
    } catch (err) {
      console.error("Schema update failed:", err);
    }
  };

  const handleDeleteCollection = async (id: string) => {
    try {
      await fetch(`/api/store/collections/${id}`, { method: "DELETE" });
      setShowDeleteConfirm(null);
      if (selectedCollection === id) setSelectedCollection(null);
      fetchCollections();
      fetchStats();
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ─── Object CRUD ───

  const handleCreateObject = async () => {
    if (!newObjTitle.trim() || !selectedCollection) return;
    try {
      await fetch("/api/store/objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collection_id: selectedCollection,
          title: newObjTitle, data: newObjData,
          tags: newObjTags ? newObjTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      });
      setShowNewObject(false);
      setNewObjTitle(""); setNewObjData({}); setNewObjTags("");
      fetchObjects(selectedCollection);
      fetchStats();
    } catch (err) {
      console.error("Failed to create object:", err);
    }
  };

  const startEditing = () => {
    if (!selectedObject) return;
    const obj = selectedObject.object;
    setEditTitle(obj.title);
    const d: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.data)) {
      d[k] = v === null || v === undefined ? "" : String(v);
    }
    setEditData(d);
    setEditTags(obj.tags.join(", "));
    setEditing(true);
  };

  const handleSaveObject = async () => {
    if (!selectedObject) return;
    setSaving(true);
    try {
      const dataToSend: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editData)) {
        // Preserve number types for number fields
        const field = selectedObject.object.collection_schema?.find((f) => f.name === k);
        if (field?.type === "number" && v !== "") {
          dataToSend[k] = Number(v);
        } else if (field?.type === "checkbox") {
          dataToSend[k] = v === "true";
        } else {
          dataToSend[k] = v;
        }
      }

      await fetch(`/api/store/objects/${selectedObject.object.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          data: dataToSend,
          tags: editTags ? editTags.split(",").map((t) => t.trim()).filter(Boolean) : [],
        }),
      });
      await fetchObjectDetail(selectedObject.object.id);
      fetchObjects(selectedCollection || undefined);
      setEditing(false);
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleArchiveObject = async (id: string) => {
    try {
      await fetch(`/api/store/objects/${id}`, { method: "DELETE" });
      setSelectedObject(null);
      fetchObjects(selectedCollection || undefined);
      fetchStats();
    } catch (err) {
      console.error("Failed to archive object:", err);
    }
  };

  const handleDeleteRelation = async (relationId: string) => {
    try {
      await fetch(`/api/store/relations/${relationId}`, { method: "DELETE" });
      if (selectedObject) fetchObjectDetail(selectedObject.object.id);
    } catch (err) {
      console.error("Failed to delete relation:", err);
    }
  };

  // ─── Derived state ───

  const displayObjects = searchResults || objects;
  const currentCollection = selectedCollection
    ? collections.find((c) => c.id === selectedCollection) : null;
  const canToggleFactFilter = !selectedCollection || currentCollection?.name === "Facts";

  return (
    <>
      {/* Header */}
      <PageHeader
        title="Store"
        subtitle={
          <MetaText size="xs" className="flex-row gap-2">
            <span>{stats.collections} collections</span>
            <span>{stats.objects} objects</span>
            <span>{stats.relations} relations</span>
          </MetaText>
        }
        actions={
          <Button size="sm" onClick={() => setShowNewCollection(true)}>+ Collection</Button>
        }
      />

      <PageBody className="store-layout" gap={0}>
        {/* ─── Left sidebar: Collections ─── */}
        <div className="store-sidebar">
          <div
            onClick={() => setSelectedCollection(null)}
            className={`store-sidebar-item${!selectedCollection ? " active" : ""}`}
          >
            All Objects
            <MetaText size="xs" className="text-right store-sidebar-count">{stats.objects}</MetaText>
          </div>

          {collections.map((c) => (
            <div key={c.id} className="store-sidebar-coll">
              {renamingCollId === c.id ? (
                <input
                  ref={renameRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRenameCollection(c.id, renameValue)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameCollection(c.id, renameValue);
                    if (e.key === "Escape") setRenamingCollId(null);
                  }}
                  className="store-sidebar-rename"
                />
              ) : (
                <>
                  <div
                    onClick={() => setSelectedCollection(c.id)}
                    className={`store-sidebar-coll-label${selectedCollection === c.id ? " active" : ""}`}
                  >
                    <span className="truncate">
                      {c.icon ? `${c.icon} ` : ""}{c.name}
                    </span>
                    <MetaText size="xs" className="flex-shrink-0 ml-1">
                      {c.object_count}
                    </MetaText>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      setCollMenu({ collection: c, x: rect.right, y: rect.top });
                    }}
                    className="store-btn-muted"
                    style={{
                      opacity: selectedCollection === c.id ? 0.7 : 0,
                      transition: "opacity 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = "0.7"}
                    onMouseLeave={(e) => { if (selectedCollection !== c.id) e.currentTarget.style.opacity = "0"; }}
                  >
                    ...
                  </button>
                </>
              )}
            </div>
          ))}

          {/* Description of selected collection */}
          {currentCollection?.description && (
            <div className="store-sidebar-desc">
              {currentCollection.description}
            </div>
          )}
        </div>

        {/* ─── Main area: Objects ─── */}
        <div className="store-main">
          {/* Search + actions bar */}
          <div className="list-page-toolbar">
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              debounceMs={0}
              placeholder={currentCollection ? `Search in ${currentCollection.name}...` : "Search all objects..."}
              resultCount={searchResults ? searchResults.length : undefined}
            />
            <Button size="sm" onClick={handleSearch}>Search</Button>
            {searchResults && (
              <Button
                size="sm"
                className="text-muted"
                onClick={() => { setSearchResults(null); setSearchQuery(""); }}
              >Clear</Button>
            )}
            {canToggleFactFilter && (
              <Button
                size="sm"
                className="text-muted"
                onClick={() => setShowOutdatedFacts((v) => !v)}
              >
                {showOutdatedFacts ? "Hide outdated facts" : "Show outdated facts"}
              </Button>
            )}
            {selectedCollection && (
              <Button variant="accent" size="sm" onClick={() => setShowNewObject(true)}>
                + New
              </Button>
            )}
          </div>

          {searchResults && (
            <MetaText size="xs" className="block mb-2">
              {searchResults.length} result(s)
            </MetaText>
          )}

          {/* Object table */}
          <div className="scroll-area">
            {loading ? (
              <EmptyState message="Loading..." />
            ) : displayObjects.length === 0 ? (
              <EmptyState
                message={searchResults ? "No results found" : selectedCollection ? "No objects yet" : "No data in the store"}
                action={
                  <>
                    {!searchResults && selectedCollection && (
                      <Button variant="accent" size="sm" onClick={() => setShowNewObject(true)}>
                        Create first object
                      </Button>
                    )}
                    {!searchResults && !selectedCollection && collections.length === 0 && (
                      <Button variant="accent" size="sm" onClick={() => setShowNewCollection(true)}>
                        Create first collection
                      </Button>
                    )}
                  </>
                }
              />
            ) : (
              <table className="store-table">
                <thead>
                  <tr>
                    <th className="store-th">Title</th>
                    {!selectedCollection && <th className="store-th">Collection</th>}
                    {currentCollection?.schema.slice(0, 4).map((f) => (
                      <th key={f.name} className="store-th">{f.name}</th>
                    ))}
                    <th className="store-th">Tags</th>
                    <th className="store-th store-th--updated">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {displayObjects.map((obj) => {
                    const isSelected = selectedObject?.object.id === obj.id;
                    return (
                      <tr
                        key={obj.id}
                        onClick={() => fetchObjectDetail(obj.id)}
                        className={isSelected ? "active" : ""}
                      >
                        <td className="store-td font-semibold store-td--title">
                          <div className="truncate">
                            {obj.title}
                          </div>
                          {obj.collection_name === "Facts" && semanticFactStatus(obj) && (
                            <div className="mt-1">
                              <Badge status={semanticFactStatus(obj) === "verified" ? "success" : semanticFactStatus(obj) === "outdated" ? "muted" : "accent"}>
                                {semanticFactStatus(obj)}
                              </Badge>
                            </div>
                          )}
                        </td>
                        {!selectedCollection && (
                          <td className="store-td text-secondary">
                            <span className="opacity-50">{obj.collection_icon} </span>{obj.collection_name}
                          </td>
                        )}
                        {currentCollection?.schema.slice(0, 4).map((f) => (
                          <td key={f.name} className="store-td text-secondary store-td--field">
                            <div className="truncate">
                              {formatFieldValue(obj.data[f.name], f.type)}
                            </div>
                          </td>
                        ))}
                        <td className="store-td">
                          <div className="flex-row flex-wrap gap-1">
                            {obj.tags.slice(0, 3).map((t) => (
                              <Badge key={t}>{t}</Badge>
                            ))}
                            {obj.tags.length > 3 && (
                              <MetaText size="xs">+{obj.tags.length - 3}</MetaText>
                            )}
                          </div>
                        </td>
                        <td className="store-td text-muted text-sm">
                          {timeAgo(obj.updated_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {!searchResults && totalObjects > objects.length && (
              <div className="store-table-footer">
                <MetaText size="xs">Showing {objects.length} of {totalObjects}</MetaText>
              </div>
            )}
          </div>
        </div>

        {/* ─── Right panel: Object detail / edit ─── */}
        {selectedObject && (
          <div className="store-detail">
            {/* Header */}
            <div className="store-detail-header">
              {editing ? (
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="store-detail-edit-title"
                />
              ) : (
                <h3 className="store-detail-title">
                  {selectedObject.object.title}
                </h3>
              )}
              <div className="flex-row gap-1 flex-shrink-0">
                {!editing && (
                  <button onClick={startEditing} className="store-btn-muted" title="Edit">
                    Edit
                  </button>
                )}
                <button
                  onClick={() => setSelectedObject(null)}
                  className="store-btn-muted" title="Close"
                >x</button>
              </div>
            </div>

            {/* Meta info */}
            <div className="flex-row flex-wrap gap-2 mb-3">
              <Badge>{selectedObject.object.collection_icon} {selectedObject.object.collection_name}</Badge>
              <Badge>{selectedObject.object.status}</Badge>
              {selectedObject.object.collection_name === "Facts" && semanticFactStatus(selectedObject.object) && (
                <Badge status={semanticFactStatus(selectedObject.object) === "verified" ? "success" : semanticFactStatus(selectedObject.object) === "outdated" ? "muted" : "accent"}>
                  {semanticFactStatus(selectedObject.object)}
                </Badge>
              )}
              <Badge>{selectedObject.object.created_by}</Badge>
            </div>

            {/* Fields */}
            <div className="mb-4">
              <SectionLabel className="mb-2">Fields</SectionLabel>
              {(selectedObject.object.collection_schema || []).map((field: SchemaField) => (
                <div key={field.name} className="mb-2">
                  <div className="store-field-label">
                    {field.name}
                    {field.required && <span className="text-error text-xs">*</span>}
                    <span className="opacity-50 text-xs">{field.type}</span>
                  </div>
                  {editing ? (
                    <FieldInput
                      field={field}
                      value={editData[field.name] || ""}
                      onChange={(v) => setEditData({ ...editData, [field.name]: v })}
                    />
                  ) : (
                    <div
                      className="store-field-value"
                      onClick={startEditing}
                      title="Click to edit"
                    >
                      {formatFieldValue(selectedObject.object.data[field.name], field.type) || (
                        <span className="store-field-empty">empty</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Tags */}
            <div className="mb-4">
              <SectionLabel className="mb-1">Tags</SectionLabel>
              {editing ? (
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="tag1, tag2, ..."
                  className="store-input"
                />
              ) : (
                <div className="flex-row flex-wrap gap-1 cursor-pointer store-tags-display" onClick={startEditing}>
                  {selectedObject.object.tags.length > 0 ? selectedObject.object.tags.map((t) => (
                    <Badge key={t} className="text-sm cursor-pointer">{t}</Badge>
                  )) : (
                    <span className="store-field-empty cursor-pointer">
                      No tags
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Save / Cancel buttons */}
            {editing && (
              <div className="flex-row gap-2 mb-4">
                <Button
                  variant="accent"
                  size="sm"
                  onClick={handleSaveObject}
                  disabled={saving}
                  className="flex-1"
                >
                  {saving ? "Saving..." : "Save"}
                </Button>
                <Button size="sm" onClick={() => setEditing(false)} className="flex-1">
                  Cancel
                </Button>
              </div>
            )}

            {/* Relations */}
            <div className="mb-4">
              <SectionLabel className="mb-1">
                Relations ({selectedObject.relations.length})
              </SectionLabel>
              {selectedObject.relations.length > 0 ? selectedObject.relations.map((rel) => {
                const isSource = rel.source_id === selectedObject.object.id;
                return (
                  <div key={rel.id} className="store-relation">
                    <span
                      onClick={() => fetchObjectDetail(isSource ? rel.target_id : rel.source_id)}
                      className="cursor-pointer flex-1"
                    >
                      <MetaText size="xs">
                        {isSource ? `${rel.relation} ->` : `<- ${rel.relation}`}
                      </MetaText>{" "}
                      <span className="font-semibold">
                        {isSource ? rel.target_title : rel.source_title}
                      </span>
                    </span>
                    <button onClick={() => handleDeleteRelation(rel.id)} className="store-btn-muted opacity-50 text-base" title="Remove relation">
                      x
                    </button>
                  </div>
                );
              }) : (
                <MetaText size="xs" className="italic">None</MetaText>
              )}
            </div>

            {/* Footer: timestamps + actions */}
            <div className="store-detail-footer">
              <div><MetaText size="xs">Created {new Date(selectedObject.object.created_at).toLocaleString()}</MetaText></div>
              <div><MetaText size="xs">Updated {new Date(selectedObject.object.updated_at).toLocaleString()}</MetaText></div>
              <div className="flex-row gap-2 mt-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleArchiveObject(selectedObject.object.id)}
                >
                  Archive
                </Button>
              </div>
            </div>
          </div>
        )}
      </PageBody>

      {/* ─── Collection context menu ─── */}
      {collMenu && (
        <CollectionMenu
          collection={collMenu.collection}
          position={{ x: collMenu.x, y: collMenu.y }}
          onClose={() => setCollMenu(null)}
          onRename={() => {
            setRenamingCollId(collMenu.collection.id);
            setRenameValue(collMenu.collection.name);
          }}
          onEditSchema={() => {
            setEditSchemaFields([...collMenu.collection.schema]);
            setShowEditSchema(collMenu.collection);
          }}
          onDelete={() => setShowDeleteConfirm(collMenu.collection)}
        />
      )}

      {/* ─── Delete confirmation ─── */}
      <Modal open={!!showDeleteConfirm} onClose={() => setShowDeleteConfirm(null)} title={showDeleteConfirm ? `Delete "${showDeleteConfirm.name}"?` : ""}>
        {showDeleteConfirm && (
          <>
            <p className="text-md text-secondary store-delete-text">
              This will permanently delete the collection and all {showDeleteConfirm.object_count} objects in it.
            </p>
            <p className="text-base text-error store-delete-warning">
              This action cannot be undone.
            </p>
            <div className="action-row">
              <Button size="sm" onClick={() => setShowDeleteConfirm(null)}>Cancel</Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleDeleteCollection(showDeleteConfirm.id)}
              >
                Delete
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* ─── New Collection Modal ─── */}
      <Modal open={showNewCollection} onClose={() => setShowNewCollection(false)} title="New Collection" width={520}>
        <div className="flex-col gap-3">
          <div className="flex-row gap-2">
            <input type="text" value={newCollIcon} onChange={(e) => setNewCollIcon(e.target.value)}
              placeholder="Icon" className="store-input text-center text-2xl store-icon-input" />
            <input type="text" value={newCollName} onChange={(e) => setNewCollName(e.target.value)}
              placeholder="Collection name" autoFocus className="store-input text-lg font-semibold" />
          </div>
          <input type="text" value={newCollDesc} onChange={(e) => setNewCollDesc(e.target.value)}
            placeholder="Description (optional)" className="store-input" />

          <SectionLabel className="mt-1">Fields</SectionLabel>
          <SchemaEditor fields={newCollFields} onChange={setNewCollFields} />

          <div className="action-row mt-1">
            <Button size="sm" onClick={() => { setShowNewCollection(false); resetNewCollForm(); }}>Cancel</Button>
            <Button variant="accent" size="sm" onClick={handleCreateCollection} disabled={!newCollName.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Edit Schema Modal ─── */}
      <Modal
        open={!!showEditSchema}
        onClose={() => setShowEditSchema(null)}
        title={showEditSchema ? `Edit Schema: ${showEditSchema.icon || ""} ${showEditSchema.name}` : ""}
        width={520}
      >
        <SchemaEditor fields={editSchemaFields} onChange={setEditSchemaFields} />
        <div className="action-row mt-3">
          <Button size="sm" onClick={() => setShowEditSchema(null)}>Cancel</Button>
          <Button variant="accent" size="sm" onClick={handleUpdateSchema}>
            Save Schema
          </Button>
        </div>
      </Modal>

      {/* ─── New Object Modal ─── */}
      <Modal
        open={showNewObject && !!currentCollection}
        onClose={() => setShowNewObject(false)}
        title={currentCollection ? `${currentCollection.icon || ""} New ${currentCollection.name}` : ""}
        width={520}
      >
        {currentCollection && (
          <div className="flex-col gap-3">
            <div>
              <label className="store-modal-label-bold">Title</label>
              <input type="text" value={newObjTitle} onChange={(e) => setNewObjTitle(e.target.value)}
                placeholder="Object title" autoFocus className="store-input text-lg font-semibold store-obj-title-input" />
            </div>

            {currentCollection.schema.map((field) => (
              <div key={field.name}>
                <label className="store-modal-label">
                  {field.name} {field.required && <span className="text-error">*</span>}
                </label>
                <FieldInput
                  field={field}
                  value={newObjData[field.name] || ""}
                  onChange={(v) => setNewObjData({ ...newObjData, [field.name]: v })}
                />
              </div>
            ))}

            <div>
              <label className="store-modal-label">Tags</label>
              <input type="text" value={newObjTags} onChange={(e) => setNewObjTags(e.target.value)}
                placeholder="tag1, tag2, ..." className="store-input" />
            </div>

            <div className="action-row mt-1">
              <Button size="sm" onClick={() => setShowNewObject(false)}>Cancel</Button>
              <Button variant="accent" size="sm" onClick={handleCreateObject} disabled={!newObjTitle.trim()}>
                Create
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

// ─── Shared sub-components ───

function SchemaEditor({ fields, onChange }: { fields: SchemaField[]; onChange: (f: SchemaField[]) => void }) {
  const update = (i: number, patch: Partial<SchemaField>) => {
    const copy = [...fields];
    copy[i] = { ...copy[i], ...patch };
    onChange(copy);
  };

  return (
    <div className="flex-col gap-1">
      {fields.map((field, i) => (
        <div key={i} className="store-schema-row">
          <input
            type="text" value={field.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Field name"
            className="store-input flex-1"
          />
          <select
            value={field.type}
            onChange={(e) => update(i, { type: e.target.value })}
            className="store-input store-schema-type-select"
          >
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label className="store-schema-req-label">
            <input type="checkbox" checked={!!field.required} onChange={(e) => update(i, { required: e.target.checked })} />
            Req
          </label>
          {(field.type === "select" || field.type === "multi_select") && (
            <input
              type="text"
              value={field.options?.join(", ") || ""}
              onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              placeholder="opt1, opt2, ..."
              className="store-input flex-1"
            />
          )}
          <button
            onClick={() => onChange(fields.filter((_, j) => j !== i))}
            className="store-btn-muted"
          >x</button>
        </div>
      ))}
      <button
        onClick={() => onChange([...fields, { name: "", type: "text" }])}
        className="store-add-field-btn"
      >+ Add field</button>
    </div>
  );
}

// ─── Helpers ───

function semanticFactStatus(obj: { collection_name?: string; semantic_status?: string; data?: Record<string, unknown> }): string | null {
  if (obj.collection_name !== "Facts") return null;
  const fromColumn = typeof obj.semantic_status === "string" ? obj.semantic_status.trim() : "";
  if (fromColumn) return fromColumn;
  const fromData = typeof obj.data?.status === "string" ? obj.data.status.trim() : "";
  return fromData || null;
}

function formatFieldValue(value: unknown, type: string): string {
  if (value === undefined || value === null) return "";
  if (type === "checkbox") return value === true || value === "true" ? "Yes" : "No";
  if (type === "json") return JSON.stringify(value).substring(0, 50);
  if (type === "multi_select" && Array.isArray(value)) return value.join(", ");
  if (type === "number" && typeof value === "number") return String(value);
  return String(value);
}
