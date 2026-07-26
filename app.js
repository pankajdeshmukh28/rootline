(() => {
  "use strict";

  /* ============================== Constants ============================== */
  const STORAGE_KEY = "kinfolk.familytree.v1";
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
    if (e.key === "Escape") { closeModal(); closeConfirm(); }
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
