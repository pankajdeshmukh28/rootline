(() => {
  "use strict";

  /* ============================== Constants ============================== */
  const STORAGE_KEY = "rootline.familytree.v1";
  const LEGACY_STORAGE_KEY = "kinfolk.familytree.v1";
  const CARD_W = 172;
  const CARD_H = 76;
  const COUPLE_GAP = 22;
  const SIBLING_GAP = 34;
  const LEVEL_H = 168;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 2.5;

  /* ============================== Storage ============================== */
  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        localStorage.setItem(STORAGE_KEY, legacyRaw);
        return JSON.parse(legacyRaw);
      }
    } catch (e) { console.warn("Failed to parse saved data", e); }
    return { trees: {}, order: [], activeTreeId: null };
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function newTree(name) {
    return {
      id: uid(),
      name: name || "Untitled tree",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      rootPersonId: null,
      people: {},
      unions: {},
    };
  }

  function touchTree(tree) { tree.updatedAt = Date.now(); }

  /* ============================== State ============================== */
  const state = {
    data: loadData(),
    selectedPersonId: null,
    view: { x: 0, y: 0, k: 1 },
    panning: false,
    panStart: null,
    pendingAction: null, // {type, personId}
    genderValue: null,
    editingPersonId: null,
  };

  if (!state.data.order.length) {
    const t = newTree("My Family");
    state.data.trees[t.id] = t;
    state.data.order.push(t.id);
    state.data.activeTreeId = t.id;
    saveData();
  }
  if (!state.data.activeTreeId || !state.data.trees[state.data.activeTreeId]) {
    state.data.activeTreeId = state.data.order[0] || null;
  }

  function activeTree() {
    return state.data.trees[state.data.activeTreeId] || null;
  }

  /* ============================== Data mutations ============================== */
  function addAncestor(tree, fields) {
    const p = makePerson(fields, null);
    tree.people[p.id] = p;
    tree.rootPersonId = p.id;
    touchTree(tree);
    return p;
  }

  function makePerson(fields, parentUnionId) {
    return {
      id: uid(),
      name: fields.name.trim(),
      gender: fields.gender || "O",
      birth: (fields.birth || "").trim(),
      death: (fields.death || "").trim(),
      notes: (fields.notes || "").trim(),
      unionId: null,
      parentUnionId: parentUnionId || null,
    };
  }

  function ensureUnionFor(tree, personId) {
    const person = tree.people[personId];
    if (person.unionId) return tree.unions[person.unionId];
    const u = { id: uid(), partners: [personId], children: [] };
    tree.unions[u.id] = u;
    person.unionId = u.id;
    return u;
  }

  function addPartner(tree, personId, fields) {
    const person = tree.people[personId];
    const union = ensureUnionFor(tree, personId);
    const partner = makePerson(fields, null);
    tree.people[partner.id] = partner;
    partner.unionId = union.id;
    union.partners.push(partner.id);
    touchTree(tree);
    return partner;
  }

  function addChild(tree, personId, fields) {
    const union = ensureUnionFor(tree, personId);
    const child = makePerson(fields, union.id);
    tree.people[child.id] = child;
    union.children.push(child.id);
    touchTree(tree);
    return child;
  }

  function addParent(tree, personId, fields) {
    const person = tree.people[personId];
    const parentUnion = { id: uid(), partners: [], children: [personId] };
    const parent = makePerson(fields, null);
    tree.people[parent.id] = parent;
    parent.unionId = parentUnion.id;
    parentUnion.partners.push(parent.id);
    tree.unions[parentUnion.id] = parentUnion;
    person.parentUnionId = parentUnion.id;
    if (tree.rootPersonId === personId) tree.rootPersonId = parent.id;
    touchTree(tree);
    return parent;
  }

  function editPerson(tree, personId, fields) {
    const p = tree.people[personId];
    p.name = fields.name.trim();
    p.gender = fields.gender || "O";
    p.birth = (fields.birth || "").trim();
    p.death = (fields.death || "").trim();
    p.notes = (fields.notes || "").trim();
    touchTree(tree);
  }

  function countDescendants(tree, personId) {
    const person = tree.people[personId];
    let count = 0;
    if (person.unionId) {
      const u = tree.unions[person.unionId];
      count += u.children.length;
      u.children.forEach((cid) => { count += countDescendants(tree, cid); });
    }
    return count;
  }

  function deleteSubtree(tree, personId) {
    const person = tree.people[personId];
    if (!person) return;
    if (person.unionId) {
      const u = tree.unions[person.unionId];
      if (u) {
        [...u.children].forEach((cid) => deleteSubtree(tree, cid));
        delete tree.unions[u.id];
      }
    }
    delete tree.people[personId];
  }

  function deletePerson(tree, personId) {
    const person = tree.people[personId];
    if (!person) return;
    // detach from parent union's child list
    if (person.parentUnionId && tree.unions[person.parentUnionId]) {
      const pu = tree.unions[person.parentUnionId];
      pu.children = pu.children.filter((id) => id !== personId);
    }
    // detach from own union as partner
    let ownUnion = person.unionId ? tree.unions[person.unionId] : null;
    deleteSubtree(tree, personId);
    if (ownUnion && tree.unions[ownUnion.id]) {
      ownUnion.partners = ownUnion.partners.filter((id) => id !== personId);
      if (ownUnion.partners.length === 0 && ownUnion.children.length === 0) {
        delete tree.unions[ownUnion.id];
      }
    }
    if (tree.rootPersonId === personId) tree.rootPersonId = null;
    touchTree(tree);
  }

  /* ============================== Layout ============================== */
  function computeLayout(tree) {
    if (!tree.rootPersonId || !tree.people[tree.rootPersonId]) return null;

    function build(personId) {
      const person = tree.people[personId];
      if (person.unionId && tree.unions[person.unionId]) {
        const u = tree.unions[person.unionId];
        const node = { type: "union", id: u.id, union: u, primaryPersonId: personId, children: [] };
        node.children = u.children.map((cid) => build(cid));
        return node;
      }
      return { type: "person", id: person.id, person, children: [] };
    }

    const root = build(tree.rootPersonId);

    function selfWidth(node) {
      if (node.type === "union") {
        const n = node.union.partners.length || 1;
        return n === 2 ? CARD_W * 2 + COUPLE_GAP : CARD_W;
      }
      return CARD_W;
    }

    function computeWidth(node) {
      const sw = selfWidth(node);
      node.selfW = sw;
      if (!node.children.length) { node.width = sw; return sw; }
      let total = 0;
      node.children.forEach((c, i) => {
        total += computeWidth(c);
        if (i > 0) total += SIBLING_GAP;
      });
      node.width = Math.max(sw, total);
      return node.width;
    }
    computeWidth(root);

    const flatNodes = [];
    const flatLinks = [];

    function place(node, leftX, depth) {
      node.y = depth * LEVEL_H;
      if (node.children.length) {
        let childrenTotal = 0;
        node.children.forEach((c, i) => { childrenTotal += c.width; if (i > 0) childrenTotal += SIBLING_GAP; });
        let cx = leftX + (node.width - childrenTotal) / 2;
        const centers = [];
        node.children.forEach((c) => {
          place(c, cx, depth + 1);
          centers.push(c.center);
          cx += c.width + SIBLING_GAP;
        });
        node.center = (centers[0] + centers[centers.length - 1]) / 2;
      } else {
        node.center = leftX + node.width / 2;
      }
      node.x = node.center - node.selfW / 2;
      flatNodes.push(node);
      node.children.forEach((c) => flatLinks.push({ from: node, to: c }));
    }
    place(root, 0, 0);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    flatNodes.forEach((n) => {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.selfW);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y + CARD_H);
    });

    return { root, flatNodes, flatLinks, bbox: { minX, maxX, minY, maxY } };
  }

  /* ============================== Rendering ============================== */
  const svg = document.getElementById("canvas");
  const viewport = document.getElementById("viewport");
  const emptyState = document.getElementById("emptyState");
  const fab = document.getElementById("fab");
  const legend = document.getElementById("legend");
  const treeNameInput = document.getElementById("treeNameInput");
  const personCountEl = document.getElementById("personCount");
  const treeListEl = document.getElementById("treeList");
  const SVGNS = "http://www.w3.org/2000/svg";
  const XHTMLNS = "http://www.w3.org/1999/xhtml";

  function fmtYears(p) {
    if (p.birth && p.death) return `${p.birth} – ${p.death}`;
    if (p.birth) return `b. ${p.birth}`;
    if (p.death) return `d. ${p.death}`;
    return "";
  }

  function genderClass(g) { return g === "M" ? "male" : g === "F" ? "female" : "other"; }

  function isBloodRelative(tree, person) {
    return person.id === tree.rootPersonId || !!person.parentUnionId;
  }

  function makeCardForeignObject(tree, person, x, y) {
    const fo = document.createElementNS(SVGNS, "foreignObject");
    fo.setAttribute("x", x);
    fo.setAttribute("y", y);
    fo.setAttribute("width", CARD_W);
    fo.setAttribute("height", CARD_H);
    fo.classList.add("card-fo");
    const marriedIn = !isBloodRelative(tree, person);
    const div = document.createElementNS(XHTMLNS, "div");
    div.className = `card ${genderClass(person.gender)}` + (marriedIn ? " married-in" : "") + (person.id === state.selectedPersonId ? " selected" : "");
    if (marriedIn) div.title = `${person.name} married into the family`;
    div.innerHTML = `
      <div class="card-top"><span class="card-gender-dot"></span><span class="card-name">${escapeHtml(person.name)}</span>${marriedIn ? '<span class="married-in-badge" title="Married in">⚭</span>' : ""}</div>
      <div class="card-years">${escapeHtml(fmtYears(person))}</div>
    `;
    div.addEventListener("click", (e) => {
      e.stopPropagation();
      selectPerson(person.id);
    });
    fo.appendChild(div);
    return fo;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function elbowPath(x1, y1, x2, y2) {
    const midY = y1 + (y2 - y1) / 2;
    return `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
  }

  function render() {
    const tree = activeTree();
    renderSidebar();
    if (!tree) {
      treeNameInput.value = "";
      personCountEl.textContent = "";
      viewport.innerHTML = "";
      emptyState.classList.remove("hidden");
      fab.hidden = true;
      legend.hidden = true;
      return;
    }
    treeNameInput.value = tree.name;
    const peopleCount = Object.keys(tree.people).length;
    personCountEl.textContent = peopleCount ? `${peopleCount} ${peopleCount === 1 ? "person" : "people"}` : "";

    viewport.innerHTML = "";

    if (!tree.rootPersonId) {
      emptyState.classList.remove("hidden");
      fab.hidden = true;
      legend.hidden = true;
      applyView();
      return;
    }
    emptyState.classList.add("hidden");
    legend.hidden = false;

    const layout = computeLayout(tree);
    if (!layout) return;

    // links first (under cards)
    layout.flatLinks.forEach(({ from, to }) => {
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute("class", "link");
      path.setAttribute("d", elbowPath(from.center, from.y + CARD_H, to.center, to.y));
      viewport.appendChild(path);
    });

    layout.flatNodes.forEach((node) => {
      if (node.type === "union") {
        const partners = node.union.partners;
        if (partners.length === 2) {
          const p1 = tree.people[partners[0]];
          const p2 = tree.people[partners[1]];
          viewport.appendChild(makeCardForeignObject(tree, p1, node.x, node.y));
          viewport.appendChild(makeCardForeignObject(tree, p2, node.x + CARD_W + COUPLE_GAP, node.y));
          const badge = document.createElementNS(SVGNS, "foreignObject");
          badge.setAttribute("x", node.x + CARD_W + COUPLE_GAP / 2 - 11);
          badge.setAttribute("y", node.y + CARD_H / 2 - 11);
          badge.setAttribute("width", 22);
          badge.setAttribute("height", 22);
          const bdiv = document.createElementNS(XHTMLNS, "div");
          bdiv.className = "union-badge";
          bdiv.textContent = "♥";
          badge.appendChild(bdiv);
          viewport.appendChild(badge);
        } else {
          const p1 = tree.people[partners[0]];
          viewport.appendChild(makeCardForeignObject(tree, p1, node.x, node.y));
        }
      } else {
        viewport.appendChild(makeCardForeignObject(tree, node.person, node.x, node.y));
      }
    });

    updateFab();
    applyView();
  }

  function renderSidebar() {
    treeListEl.innerHTML = "";
    state.data.order.forEach((id) => {
      const t = state.data.trees[id];
      if (!t) return;
      const li = document.createElement("li");
      li.className = "tree-item" + (id === state.data.activeTreeId ? " active" : "");
      const count = Object.keys(t.people).length;
      li.innerHTML = `
        <span class="tree-item-name">${escapeHtml(t.name)} <span class="tree-item-meta">${count}</span></span>
        <button class="tree-item-del" title="Delete tree">✕</button>
      `;
      li.addEventListener("click", () => {
        state.data.activeTreeId = id;
        state.selectedPersonId = null;
        saveData();
        resetView();
        render();
      });
      li.querySelector(".tree-item-del").addEventListener("click", (e) => {
        e.stopPropagation();
        openConfirm(`Delete "${t.name}"?`, "This removes the tree and everyone in it. This can't be undone.", () => {
          delete state.data.trees[id];
          state.data.order = state.data.order.filter((x) => x !== id);
          if (state.data.activeTreeId === id) {
            state.data.activeTreeId = state.data.order[0] || null;
          }
          saveData();
          resetView();
          render();
        });
      });
      treeListEl.appendChild(li);
    });
  }

  /* ============================== Selection & FAB ============================== */
  function selectPerson(id) {
    state.selectedPersonId = id;
    render();
  }

  function updateFab() {
    const tree = activeTree();
    if (!tree || !state.selectedPersonId || !tree.people[state.selectedPersonId]) {
      fab.hidden = true;
      return;
    }
    const person = tree.people[state.selectedPersonId];
    fab.hidden = false;
    document.getElementById("addPartnerBtn").disabled = !!person.unionId && tree.unions[person.unionId].partners.length >= 2;
    document.getElementById("addParentBtn").disabled = !!person.parentUnionId;
  }

  svg.addEventListener("click", (e) => {
    if (e.target === svg || e.target === viewport) {
      state.selectedPersonId = null;
      render();
    }
  });

  /* ============================== Pan & zoom ============================== */
  function applyView(animated) {
    viewport.style.transition = animated ? "transform .35s cubic-bezier(.2,.8,.3,1)" : "none";
    viewport.style.transform = `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.k})`;
  }

  function resetView() { state.view = { x: 0, y: 0, k: 1 }; }

  function fitToScreen() {
    const tree = activeTree();
    if (!tree || !tree.rootPersonId) { resetView(); applyView(true); return; }
    const layout = computeLayout(tree);
    if (!layout) return;
    const wrap = document.getElementById("canvasWrap");
    const pad = 60;
    const padBottom = 130; // leave room for the floating FAB toolbar
    const bw = layout.bbox.maxX - layout.bbox.minX;
    const bh = layout.bbox.maxY - layout.bbox.minY;
    const availW = wrap.clientWidth - pad * 2;
    const availH = wrap.clientHeight - pad - padBottom;
    let k = Math.min(availW / bw, availH / bh, MAX_ZOOM);
    if (!isFinite(k) || k <= 0) k = 1;
    k = Math.max(k, MIN_ZOOM);
    const cx = (layout.bbox.minX + layout.bbox.maxX) / 2;
    const cy = (layout.bbox.minY + layout.bbox.maxY) / 2;
    state.view.k = k;
    state.view.x = wrap.clientWidth / 2 - cx * k;
    state.view.y = (pad + (wrap.clientHeight - pad - padBottom) / 2) - cy * k;
    applyView(true);
  }

  svg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    state.panning = true;
    state.panStart = { mx: e.clientX, my: e.clientY, vx: state.view.x, vy: state.view.y };
    svg.classList.add("grabbing");
  });
  window.addEventListener("mousemove", (e) => {
    if (!state.panning) return;
    const dx = e.clientX - state.panStart.mx;
    const dy = e.clientY - state.panStart.my;
    state.view.x = state.panStart.vx + dx;
    state.view.y = state.panStart.vy + dy;
    applyView(false);
  });
  window.addEventListener("mouseup", () => { state.panning = false; svg.classList.remove("grabbing"); });

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const delta = -e.deltaY * 0.0016;
    const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.view.k * (1 + delta)));
    const ratio = newK / state.view.k;
    state.view.x = mx - (mx - state.view.x) * ratio;
    state.view.y = my - (my - state.view.y) * ratio;
    state.view.k = newK;
    applyView(false);
  }, { passive: false });

  document.getElementById("zoomInBtn").addEventListener("click", () => { zoomBy(1.2); });
  document.getElementById("zoomOutBtn").addEventListener("click", () => { zoomBy(1 / 1.2); });
  document.getElementById("zoomResetBtn").addEventListener("click", fitToScreen);

  function zoomBy(factor) {
    const wrap = document.getElementById("canvasWrap");
    const mx = wrap.clientWidth / 2, my = wrap.clientHeight / 2;
    const newK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.view.k * factor));
    const ratio = newK / state.view.k;
    state.view.x = mx - (mx - state.view.x) * ratio;
    state.view.y = my - (my - state.view.y) * ratio;
    state.view.k = newK;
    applyView(true);
  }

  /* ============================== Modal: add/edit person ============================== */
  const modalOverlay = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const personForm = document.getElementById("personForm");
  const fName = document.getElementById("fName");
  const fBirth = document.getElementById("fBirth");
  const fDeath = document.getElementById("fDeath");
  const fNotes = document.getElementById("fNotes");

  document.querySelectorAll(".gender-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".gender-opt").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.genderValue = btn.dataset.gender;
    });
  });

  function openPersonModal(title, action, prefill) {
    modalTitle.textContent = title;
    state.pendingAction = action;
    fName.value = prefill?.name || "";
    fBirth.value = prefill?.birth || "";
    fDeath.value = prefill?.death || "";
    fNotes.value = prefill?.notes || "";
    state.genderValue = prefill?.gender || "F";
    document.querySelectorAll(".gender-opt").forEach((b) => b.classList.toggle("active", b.dataset.gender === state.genderValue));
    modalOverlay.hidden = false;
    setTimeout(() => fName.focus(), 30);
  }

  function closeModal() { modalOverlay.hidden = true; state.pendingAction = null; }

  document.getElementById("modalCancel").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

  personForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const tree = activeTree();
    if (!tree || !state.pendingAction) return;
    const fields = { name: fName.value, gender: state.genderValue, birth: fBirth.value, death: fDeath.value, notes: fNotes.value };
    if (!fields.name.trim()) return;

    const { type, personId } = state.pendingAction;
    let newSelId = state.selectedPersonId;
    if (type === "addAncestor") {
      const p = addAncestor(tree, fields);
      newSelId = p.id;
    } else if (type === "addPartner") {
      const p = addPartner(tree, personId, fields);
      newSelId = p.id;
    } else if (type === "addChild") {
      const p = addChild(tree, personId, fields);
      newSelId = p.id;
    } else if (type === "addParent") {
      const p = addParent(tree, personId, fields);
      newSelId = p.id;
    } else if (type === "edit") {
      editPerson(tree, personId, fields);
      newSelId = personId;
    }
    saveData();
    state.selectedPersonId = newSelId;
    closeModal();
    render();
    requestAnimationFrame(() => fitToScreen());
    showToast(type === "edit" ? "Saved" : "Added to the tree");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeConfirm(); document.getElementById("posterOverlay").hidden = true; }
  });

  /* ============================== Confirm modal ============================== */
  const confirmOverlay = document.getElementById("confirmOverlay");
  let confirmCb = null;
  function openConfirm(title, body, onConfirm) {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmBody").textContent = body;
    confirmCb = onConfirm;
    confirmOverlay.hidden = false;
  }
  function closeConfirm() { confirmOverlay.hidden = true; confirmCb = null; }
  document.getElementById("confirmCancel").addEventListener("click", closeConfirm);
  document.getElementById("confirmOk").addEventListener("click", () => {
    if (confirmCb) confirmCb();
    closeConfirm();
  });
  confirmOverlay.addEventListener("click", (e) => { if (e.target === confirmOverlay) closeConfirm(); });

  /* ============================== Toolbar actions ============================== */
  document.getElementById("addAncestorBtn").addEventListener("click", () => {
    openPersonModal("Add ancestor", { type: "addAncestor" });
  });
  document.getElementById("addPartnerBtn").addEventListener("click", () => {
    if (!state.selectedPersonId) return;
    openPersonModal("Add partner", { type: "addPartner", personId: state.selectedPersonId });
  });
  document.getElementById("addChildBtn").addEventListener("click", () => {
    if (!state.selectedPersonId) return;
    openPersonModal("Add child", { type: "addChild", personId: state.selectedPersonId });
  });
  document.getElementById("addParentBtn").addEventListener("click", () => {
    if (!state.selectedPersonId) return;
    openPersonModal("Add parent", { type: "addParent", personId: state.selectedPersonId });
  });
  document.getElementById("editNodeBtn").addEventListener("click", () => {
    const tree = activeTree();
    if (!tree || !state.selectedPersonId) return;
    const p = tree.people[state.selectedPersonId];
    openPersonModal("Edit person", { type: "edit", personId: p.id }, p);
  });
  document.getElementById("deleteNodeBtn").addEventListener("click", () => {
    const tree = activeTree();
    if (!tree || !state.selectedPersonId) return;
    const p = tree.people[state.selectedPersonId];
    const descendants = countDescendants(tree, p.id);
    const body = descendants > 0
      ? `This removes ${p.name} and ${descendants} descendant${descendants === 1 ? "" : "s"}. This can't be undone.`
      : `This removes ${p.name} from the tree. This can't be undone.`;
    openConfirm("Delete this person?", body, () => {
      deletePerson(tree, p.id);
      state.selectedPersonId = null;
      saveData();
      render();
      requestAnimationFrame(() => fitToScreen());
    });
  });

  /* ============================== Tree name / new tree ============================== */
  treeNameInput.addEventListener("input", () => {
    const tree = activeTree();
    if (!tree) return;
    tree.name = treeNameInput.value;
    touchTree(tree);
    saveData();
    renderSidebar();
  });

  document.getElementById("newTreeBtn").addEventListener("click", () => {
    const t = newTree("New tree");
    state.data.trees[t.id] = t;
    state.data.order.unshift(t.id);
    state.data.activeTreeId = t.id;
    state.selectedPersonId = null;
    saveData();
    resetView();
    render();
    setTimeout(() => { treeNameInput.focus(); treeNameInput.select(); }, 30);
    showToast("New tree created");
  });

  /* ============================== Import / Export ============================== */
  document.getElementById("exportBtn").addEventListener("click", () => {
    const tree = activeTree();
    if (!tree) return;
    const blob = new Blob([JSON.stringify(tree, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tree.name.replace(/[^\w\- ]+/g, "").trim() || "family-tree"}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importInput").click();
  });
  document.getElementById("importInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!imported.people || !imported.unions) throw new Error("bad shape");
        const idMap = new Map();
        const remap = (id) => {
          if (!id) return id;
          if (!idMap.has(id)) idMap.set(id, uid());
          return idMap.get(id);
        };
        const t = newTree((imported.name || "Imported tree") + " (imported)");
        Object.values(imported.people).forEach((p) => {
          const np = { ...p, id: remap(p.id) };
          t.people[np.id] = np;
        });
        Object.values(imported.unions).forEach((u) => {
          const nu = { ...u, id: remap(u.id), partners: u.partners.map(remap), children: u.children.map(remap) };
          t.unions[nu.id] = nu;
        });
        Object.values(t.people).forEach((p) => {
          p.unionId = p.unionId ? idMap.get(p.unionId) || null : null;
          p.parentUnionId = p.parentUnionId ? idMap.get(p.parentUnionId) || null : null;
        });
        t.rootPersonId = imported.rootPersonId ? idMap.get(imported.rootPersonId) : null;
        state.data.trees[t.id] = t;
        state.data.order.unshift(t.id);
        state.data.activeTreeId = t.id;
        state.selectedPersonId = null;
        saveData();
        resetView();
        render();
        requestAnimationFrame(() => fitToScreen());
        showToast("Tree imported");
      } catch (err) {
        showToast("Could not import that file");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  /* ============================== Poster export ============================== */
  const POSTER_THEMES = {
    cream: {
      label: "Cream",
      bg: "#f8f4ea", frame: "#c9bfa5", ink: "#2b2620", dim: "#8a8172", line: "#b5ac96", motif: "#8a7d5e",
      male:   { fill: "#e3edf8", stroke: "#7fa8d4", accent: "#3b6ea8" },
      female: { fill: "#f9e7ef", stroke: "#d490b0", accent: "#b04a78" },
      other:  { fill: "#ece7f6", stroke: "#a795d0", accent: "#6a4fa8" },
      marriedFill: "#fdfbf5",
    },
    heritage: {
      label: "Heritage",
      bg: "#f0e6d2", frame: "#a8916b", ink: "#3d2f1f", dim: "#8b7355", line: "#b09a75", motif: "#8b6f47",
      male:   { fill: "#dde5e8", stroke: "#8ba3ae", accent: "#4a6b7c" },
      female: { fill: "#f2ded8", stroke: "#c99a8c", accent: "#a05a48" },
      other:  { fill: "#e8e0ea", stroke: "#a892b0", accent: "#6e5578" },
      marriedFill: "#f8f2e6",
    },
    forest: {
      label: "Forest",
      bg: "#eef2ec", frame: "#9db39a", ink: "#1f2b20", dim: "#6b7a6c", line: "#a4b5a2", motif: "#5f7d60",
      male:   { fill: "#dfeaf3", stroke: "#7fa8d4", accent: "#3b6ea8" },
      female: { fill: "#f6e4ec", stroke: "#d490b0", accent: "#b04a78" },
      other:  { fill: "#e8e3f3", stroke: "#a795d0", accent: "#6a4fa8" },
      marriedFill: "#f9fbf8",
    },
    botanical: {
      label: "Botanical",
      bg: "#f4f7f0", frame: "#7d9b6f", ink: "#22301c", dim: "#61785a", line: "#96ac8c", motif: "#4e7043",
      male:   { fill: "#e0ecdf", stroke: "#7ba17d", accent: "#3f6b45" },
      female: { fill: "#f7e6e0", stroke: "#cf9c88", accent: "#a35f44" },
      other:  { fill: "#e9e6f0", stroke: "#a094bc", accent: "#63558a" },
      marriedFill: "#fbfdf8",
    },
    blush: {
      label: "Blush",
      bg: "#fdf2f4", frame: "#e0b8c2", ink: "#3d252b", dim: "#96707a", line: "#dcb2be", motif: "#c98b9c",
      male:   { fill: "#e6edf7", stroke: "#8fabd0", accent: "#41669b" },
      female: { fill: "#fbe0e9", stroke: "#e09ab6", accent: "#b8517c" },
      other:  { fill: "#efe6f4", stroke: "#b89ccc", accent: "#7a558f" },
      marriedFill: "#fffafb",
    },
    ink: {
      label: "Ink",
      bg: "#20242c", frame: "#4a5264", ink: "#eef0f4", dim: "#9aa3b2", line: "#565f72", motif: "#8d99b0",
      male:   { fill: "#2a3648", stroke: "#5d83b8", accent: "#8fb8e8" },
      female: { fill: "#3d2a37", stroke: "#b06a90", accent: "#e89ec4" },
      other:  { fill: "#332c48", stroke: "#8a74c0", accent: "#bda8ee" },
      marriedFill: "#262b35",
    },
    midnight: {
      label: "Midnight",
      bg: "#141a2e", frame: "#3d4a72", ink: "#e9edf8", dim: "#8f9ac0", line: "#47547d", motif: "#7d8cc0",
      male:   { fill: "#1e2b4a", stroke: "#5578b8", accent: "#93b6f0" },
      female: { fill: "#3a2044", stroke: "#a05a9c", accent: "#e298d8" },
      other:  { fill: "#2a2350", stroke: "#7a6ac0", accent: "#b3a2f0" },
      marriedFill: "#1a2038",
    },
    blueprint: {
      label: "Blueprint",
      bg: "#12314f", frame: "#4a7fa8", ink: "#e8f4ff", dim: "#9dc0da", line: "#5a8fb8", motif: "#7fb4d8",
      male:   { fill: "#1a4266", stroke: "#5a9fd4", accent: "#a8d4f0" },
      female: { fill: "#2b3f6b", stroke: "#8a9dd4", accent: "#c2cdf5" },
      other:  { fill: "#1f4a5e", stroke: "#5aa8b8", accent: "#a2dce8" },
      marriedFill: "#163a5c",
    },
  };

  const POSTER_FONTS = {
    classic:    { label: "Classic",    display: "Georgia, 'Times New Roman', serif", body: "-apple-system, 'Segoe UI', system-ui, sans-serif" },
    elegant:    { label: "Elegant",    display: "Didot, 'Bodoni MT', 'Playfair Display', Georgia, serif", body: "Optima, Candara, 'Segoe UI', system-ui, sans-serif" },
    modern:     { label: "Modern",     display: "'Helvetica Neue', Helvetica, Arial, sans-serif", body: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
    storybook:  { label: "Storybook",  display: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif", body: "'Avenir Next', Avenir, 'Segoe UI', sans-serif" },
    typewriter: { label: "Typewriter", display: "'Courier New', Courier, monospace", body: "'Courier New', Courier, monospace" },
  };

  const POSTER_BACKDROPS = { none: "None", canopy: "Canopy", roots: "Roots", wreath: "Wreath", vines: "Vines", rings: "Rings" };
  const POSTER_FRAMES = { none: "None", thin: "Thin", double: "Double", ornate: "Ornate" };

  const POSTER_TEMPLATES = [
    { id: "homestead",  label: "Homestead",   theme: "cream",     font: "classic",    backdrop: "canopy", frame: "double" },
    { id: "heirloom",   label: "Heirloom",    theme: "heritage",  font: "elegant",    backdrop: "wreath", frame: "ornate" },
    { id: "grove",      label: "Grove",       theme: "forest",    font: "storybook",  backdrop: "canopy", frame: "thin" },
    { id: "botanist",   label: "Botanist",    theme: "botanical", font: "storybook",  backdrop: "vines",  frame: "none" },
    { id: "rosegarden", label: "Rose Garden", theme: "blush",     font: "elegant",    backdrop: "wreath", frame: "double" },
    { id: "nocturne",   label: "Nocturne",    theme: "midnight",  font: "modern",     backdrop: "rings",  frame: "thin" },
    { id: "archive",    label: "Archive",     theme: "ink",       font: "modern",     backdrop: "none",   frame: "thin" },
    { id: "draft",      label: "Draft",       theme: "blueprint", font: "typewriter", backdrop: "rings",  frame: "thin" },
  ];

  /* --- procedural decorative backdrops (self-contained, no external assets) --- */
  function leafShape(x, y, angle, len, wid, fill) {
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${len.toFixed(1)}" ry="${wid.toFixed(1)}" transform="rotate(${angle.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}"/>`;
  }

  function backdropSVG(kind, W, H, t) {
    const c = t.motif;
    const s = [];
    if (kind === "canopy") {
      const cx = W / 2, cy = H * 0.46, R = Math.min(W * 0.40, H * 0.33);
      s.push(`<g fill="${c}" opacity="0.07">`);
      s.push(`<path d="M ${cx - R * 0.07} ${H * 0.88} Q ${cx - R * 0.05} ${cy + R * 0.55} ${cx - R * 0.17} ${cy + R * 0.15} L ${cx + R * 0.17} ${cy + R * 0.15} Q ${cx + R * 0.05} ${cy + R * 0.55} ${cx + R * 0.07} ${H * 0.88} Z"/>`);
      [[0, -0.55, 0.50], [-0.52, -0.26, 0.42], [0.52, -0.26, 0.42], [-0.34, 0.10, 0.38], [0.34, 0.10, 0.38], [0, -0.10, 0.48]]
        .forEach(([dx, dy, r]) => s.push(`<circle cx="${(cx + dx * R).toFixed(1)}" cy="${(cy + dy * R).toFixed(1)}" r="${(r * R).toFixed(1)}"/>`));
      s.push(`</g>`);
    } else if (kind === "roots") {
      const bx = W / 2, by = H * 0.93;
      s.push(`<g fill="none" stroke="${c}" opacity="0.09" stroke-linecap="round">`);
      for (let i = -4; i <= 4; i++) {
        if (i === 0) continue;
        const spread = i * W * 0.085;
        s.push(`<path d="M ${bx} ${by} Q ${(bx + spread * 0.35).toFixed(1)} ${(by - H * 0.09).toFixed(1)} ${(bx + spread).toFixed(1)} ${(by - H * 0.015).toFixed(1)}" stroke-width="${7 - Math.abs(i)}"/>`);
      }
      s.push(`<path d="M ${bx} ${(by - H * 0.16).toFixed(1)} L ${bx} ${by}" stroke-width="8"/>`);
      s.push(`</g>`);
    } else if (kind === "wreath") {
      const cx = W / 2, cy = H * 0.52, rx = W * 0.40, ry = H * 0.38;
      s.push(`<g opacity="0.10">`);
      for (let i = 0; i < 44; i++) {
        const a = (i / 44) * Math.PI * 2 + Math.PI / 2;
        const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
        s.push(leafShape(x, y, (a * 180) / Math.PI + 90, Math.min(W, H) * 0.035, Math.min(W, H) * 0.013, c));
      }
      s.push(`</g>`);
    } else if (kind === "vines") {
      const m = Math.min(W, H) * 0.075;
      s.push(`<g opacity="0.10">`);
      const runs = [
        { x0: m, y0: m, dx: 1, dy: 0, len: W - m * 2, rot: 0 },
        { x0: W - m, y0: H - m, dx: -1, dy: 0, len: W - m * 2, rot: 180 },
        { x0: m, y0: H - m, dx: 0, dy: -1, len: H - m * 2, rot: 270 },
        { x0: W - m, y0: m, dx: 0, dy: 1, len: H - m * 2, rot: 90 },
      ];
      runs.forEach((r) => {
        const n = Math.max(6, Math.round(r.len / (Math.min(W, H) * 0.06)));
        for (let i = 0; i <= n; i++) {
          const f = i / n;
          const x = r.x0 + r.dx * r.len * f, y = r.y0 + r.dy * r.len * f;
          s.push(leafShape(x, y, r.rot + (i % 2 ? 34 : -34), Math.min(W, H) * 0.026, Math.min(W, H) * 0.010, c));
        }
      });
      s.push(`</g>`);
    } else if (kind === "rings") {
      const cx = W / 2, cy = H * 0.5, step = Math.min(W, H) * 0.042;
      s.push(`<g fill="none" stroke="${c}" opacity="0.08">`);
      for (let i = 1; i <= 16; i++) {
        s.push(`<ellipse cx="${cx}" cy="${cy}" rx="${(i * step * 1.08).toFixed(1)}" ry="${(i * step).toFixed(1)}" stroke-width="${i % 3 === 0 ? 2.6 : 1.3}"/>`);
      }
      s.push(`</g>`);
    }
    return s.join("");
  }

  function frameSVG(kind, W, H, pad, t) {
    if (kind === "none") return "";
    const f = pad * 0.45;
    const s = [`<rect x="${f}" y="${f}" width="${W - f * 2}" height="${H - f * 2}" fill="none" stroke="${t.frame}" stroke-width="3"/>`];
    if (kind === "double" || kind === "ornate") {
      s.push(`<rect x="${f + 10}" y="${f + 10}" width="${W - f * 2 - 20}" height="${H - f * 2 - 20}" fill="none" stroke="${t.frame}" stroke-width="1"/>`);
    }
    if (kind === "ornate") {
      const d = 16;
      [[f, f], [W - f, f], [f, H - f], [W - f, H - f]].forEach(([x, y]) => {
        s.push(`<rect x="${x - d / 2}" y="${y - d / 2}" width="${d}" height="${d}" transform="rotate(45 ${x} ${y})" fill="${t.bg}" stroke="${t.frame}" stroke-width="2"/>`);
      });
    }
    return s.join("");
  }

  function escapeXml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
  }

  function buildPosterSVG(tree, opts) {
    const layout = computeLayout(tree);
    if (!layout) return null;
    const t = POSTER_THEMES[opts.theme] || POSTER_THEMES.cream;
    const f = POSTER_FONTS[opts.font] || POSTER_FONTS.classic;
    const bb = layout.bbox;
    const treeW = bb.maxX - bb.minX;
    const treeH = bb.maxY - bb.minY;

    const pad = Math.max(140, treeW * 0.08);
    const W = treeW + pad * 2;
    const titleSize = Math.min(120, Math.max(44, W * 0.05));
    const subSize = titleSize * 0.34;
    const titleBlockH = titleSize * 2.6 + (opts.subtitle ? subSize * 2 : 0);
    const footerH = 90;
    const H = titleBlockH + treeH + footerH + pad * 2;

    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${f.display}">`);
    parts.push(`<rect width="${W}" height="${H}" fill="${t.bg}"/>`);
    parts.push(backdropSVG(opts.backdrop, W, H, t));
    parts.push(frameSVG(opts.frame, W, H, pad, t));

    // title block
    let ty = pad + titleSize * 1.1;
    parts.push(`<text x="${W / 2}" y="${ty}" text-anchor="middle" font-size="${titleSize}" font-weight="bold" fill="${t.ink}">${escapeXml(opts.title)}</text>`);
    ty += titleSize * 0.55;
    const ruleHalf = Math.min(220, W * 0.14);
    parts.push(`<line x1="${W / 2 - ruleHalf}" y1="${ty}" x2="${W / 2 - 18}" y2="${ty}" stroke="${t.frame}" stroke-width="2"/>`);
    parts.push(`<line x1="${W / 2 + 18}" y1="${ty}" x2="${W / 2 + ruleHalf}" y2="${ty}" stroke="${t.frame}" stroke-width="2"/>`);
    parts.push(`<rect x="${W / 2 - 6}" y="${ty - 6}" width="12" height="12" transform="rotate(45 ${W / 2} ${ty})" fill="${t.frame}"/>`);
    if (opts.subtitle) {
      ty += subSize * 1.7;
      parts.push(`<text x="${W / 2}" y="${ty}" text-anchor="middle" font-size="${subSize}" font-style="italic" fill="${t.dim}">${escapeXml(opts.subtitle)}</text>`);
    }

    // tree group
    const gx = pad - bb.minX;
    const gy = pad + titleBlockH - bb.minY;
    parts.push(`<g transform="translate(${gx} ${gy})" font-family="${f.body}">`);

    layout.flatLinks.forEach(({ from, to }) => {
      parts.push(`<path d="${elbowPath(from.center, from.y + CARD_H, to.center, to.y)}" fill="none" stroke="${t.line}" stroke-width="2.5"/>`);
    });

    const drawCard = (person, x, y) => {
      const g = t[genderClass(person.gender)] || t.other;
      const married = !isBloodRelative(tree, person);
      const fill = married ? t.marriedFill : g.fill;
      const dash = married ? ` stroke-dasharray="7 5"` : "";
      parts.push(`<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="13" fill="${fill}" stroke="${g.stroke}" stroke-width="2"${dash}/>`);
      parts.push(`<circle cx="${x + 17}" cy="${y + 30}" r="4.5" fill="${g.accent}"/>`);
      parts.push(`<text x="${x + 28}" y="${y + 35}" font-size="14" font-weight="bold" fill="${t.ink}">${escapeXml(truncate(person.name, 17))}</text>`);
      const years = fmtYears(person);
      if (years) parts.push(`<text x="${x + 28}" y="${y + 54}" font-size="11.5" fill="${t.dim}">${escapeXml(years)}</text>`);
    };

    layout.flatNodes.forEach((node) => {
      if (node.type === "union") {
        const partners = node.union.partners;
        if (partners.length === 2) {
          drawCard(tree.people[partners[0]], node.x, node.y);
          drawCard(tree.people[partners[1]], node.x + CARD_W + COUPLE_GAP, node.y);
          const bx = node.x + CARD_W + COUPLE_GAP / 2, by = node.y + CARD_H / 2;
          parts.push(`<circle cx="${bx}" cy="${by}" r="11" fill="${t.bg}" stroke="${t.line}" stroke-width="1.5"/>`);
          parts.push(`<text x="${bx}" y="${by + 4}" text-anchor="middle" font-size="11" fill="${t.ink}">♥</text>`);
        } else {
          drawCard(tree.people[partners[0]], node.x, node.y);
        }
      } else {
        drawCard(node.person, node.x, node.y);
      }
    });
    parts.push(`</g>`);

    // footer
    const count = Object.keys(tree.people).length;
    parts.push(`<text x="${W / 2}" y="${H - pad * 0.75}" text-anchor="middle" font-size="${Math.max(16, subSize * 0.75)}" fill="${t.dim}">${count} family members · Made with Rootline</text>`);
    parts.push(`</svg>`);
    return { svg: parts.join(""), width: W, height: H };
  }

  const posterOverlay = document.getElementById("posterOverlay");
  const posterPreview = document.getElementById("posterPreview");
  const posterTitle = document.getElementById("posterTitle");
  const posterSubtitle = document.getElementById("posterSubtitle");
  const posterStyle = { theme: "cream", font: "classic", backdrop: "canopy", frame: "double" };

  function posterOpts() {
    return {
      title: posterTitle.value.trim() || activeTree()?.name || "Family Tree",
      subtitle: posterSubtitle.value.trim(),
      ...posterStyle,
    };
  }

  function renderPosterPreview() {
    const tree = activeTree();
    if (!tree || !tree.rootPersonId) return;
    const out = buildPosterSVG(tree, posterOpts());
    posterPreview.innerHTML = out ? out.svg : "";
    syncPosterControls();
  }

  function syncPosterControls() {
    document.querySelectorAll("[data-poster-axis]").forEach((btn) => {
      btn.classList.toggle("active", posterStyle[btn.dataset.posterAxis] === btn.dataset.posterValue);
    });
    const match = POSTER_TEMPLATES.find((tpl) =>
      tpl.theme === posterStyle.theme && tpl.font === posterStyle.font &&
      tpl.backdrop === posterStyle.backdrop && tpl.frame === posterStyle.frame);
    document.querySelectorAll("[data-poster-template]").forEach((btn) => {
      btn.classList.toggle("active", !!match && btn.dataset.posterTemplate === match.id);
    });
  }

  function buildPosterControls() {
    const tplWrap = document.getElementById("posterTemplates");
    tplWrap.innerHTML = "";
    POSTER_TEMPLATES.forEach((tpl) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "poster-chip";
      b.dataset.posterTemplate = tpl.id;
      b.textContent = tpl.label;
      b.addEventListener("click", () => {
        Object.assign(posterStyle, { theme: tpl.theme, font: tpl.font, backdrop: tpl.backdrop, frame: tpl.frame });
        renderPosterPreview();
      });
      tplWrap.appendChild(b);
    });

    const palWrap = document.getElementById("posterPalettes");
    palWrap.innerHTML = "";
    Object.entries(POSTER_THEMES).forEach(([id, th]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "poster-swatch";
      b.dataset.posterAxis = "theme";
      b.dataset.posterValue = id;
      b.title = th.label;
      b.innerHTML = `<span class="sw-bg" style="background:${th.bg}"><span class="sw-a" style="background:${th.male.accent}"></span><span class="sw-b" style="background:${th.female.accent}"></span></span>`;
      b.addEventListener("click", () => { posterStyle.theme = id; renderPosterPreview(); });
      palWrap.appendChild(b);
    });

    const axes = [
      ["posterFonts", "font", Object.fromEntries(Object.entries(POSTER_FONTS).map(([k, v]) => [k, v.label]))],
      ["posterBackdrops", "backdrop", POSTER_BACKDROPS],
      ["posterFrames", "frame", POSTER_FRAMES],
    ];
    axes.forEach(([containerId, axis, options]) => {
      const wrap = document.getElementById(containerId);
      wrap.innerHTML = "";
      Object.entries(options).forEach(([id, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "poster-chip";
        b.dataset.posterAxis = axis;
        b.dataset.posterValue = id;
        b.textContent = label;
        b.addEventListener("click", () => { posterStyle[axis] = id; renderPosterPreview(); });
        wrap.appendChild(b);
      });
    });
  }

  document.getElementById("posterBtn").addEventListener("click", () => {
    const tree = activeTree();
    if (!tree || !tree.rootPersonId) { showToast("Add people to the tree first"); return; }
    posterTitle.value = tree.name;
    posterOverlay.hidden = false;
    renderPosterPreview();
  });
  document.getElementById("posterCancel").addEventListener("click", () => { posterOverlay.hidden = true; });
  posterOverlay.addEventListener("click", (e) => { if (e.target === posterOverlay) posterOverlay.hidden = true; });
  posterTitle.addEventListener("input", renderPosterPreview);
  posterSubtitle.addEventListener("input", renderPosterPreview);
  buildPosterControls();

  function posterFilename(ext) {
    const tree = activeTree();
    return `${(tree.name || "family-tree").replace(/[^\w\- ]+/g, "").trim() || "family-tree"}-poster.${ext}`;
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.getElementById("posterSvgBtn").addEventListener("click", () => {
    const out = buildPosterSVG(activeTree(), posterOpts());
    if (!out) return;
    downloadBlob(new Blob([out.svg], { type: "image/svg+xml" }), posterFilename("svg"));
    showToast("SVG downloaded");
  });

  document.getElementById("posterPngBtn").addEventListener("click", () => {
    const out = buildPosterSVG(activeTree(), posterOpts());
    if (!out) return;
    // scale up to print resolution, capped to keep canvas memory sane (~32MP)
    const scale = Math.min(4, Math.sqrt(32e6 / (out.width * out.height)));
    const img = new Image();
    const url = URL.createObjectURL(new Blob([out.svg], { type: "image/svg+xml" }));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(out.width * scale);
      canvas.height = Math.round(out.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (blob) { downloadBlob(blob, posterFilename("png")); showToast("PNG downloaded"); }
        else showToast("Export failed — try SVG instead");
      }, "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); showToast("Export failed — try SVG instead"); };
    img.src = url;
  });

  /* ============================== Print ============================== */
  document.getElementById("printBtn").addEventListener("click", () => {
    const tree = activeTree();
    const printSheet = document.getElementById("printSheet");
    printSheet.innerHTML = "";
    if (!tree || !tree.rootPersonId) { window.print(); return; }
    const layout = computeLayout(tree);
    const pad = 30;
    const w = layout.bbox.maxX - layout.bbox.minX + pad * 2;
    const h = layout.bbox.maxY - layout.bbox.minY + pad * 2;

    const header = document.createElement("div");
    const today = new Date();
    header.innerHTML = `<div class="print-title">${escapeHtml(tree.name)}</div>
      <div class="print-meta">${Object.keys(tree.people).length} people · printed ${today.toLocaleDateString()}</div>`;
    printSheet.appendChild(header);

    const clone = svg.cloneNode(false);
    clone.setAttribute("viewBox", `${layout.bbox.minX - pad} ${layout.bbox.minY - pad} ${w} ${h}`);
    clone.setAttribute("width", w);
    clone.setAttribute("height", h);
    clone.removeAttribute("style");
    const vp = viewport.cloneNode(true);
    vp.removeAttribute("style");
    clone.appendChild(vp);
    printSheet.appendChild(clone);

    window.print();
  });

  /* ============================== Toast ============================== */
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }

  /* ============================== Resize ============================== */
  window.addEventListener("resize", () => { /* keep current pan/zoom on resize */ });

  /* ============================== Init ============================== */
  render();
  requestAnimationFrame(() => fitToScreen());
})();
