import {EditorView, ViewPlugin, ViewCommand, ViewUpdate, Decoration} from "../../view"
import {EditorState, Annotation, EditorSelection} from "../../state"
import {panels, openPanel, closePanel} from "../../panel"
import {Text} from "../../text"
import {SearchCursor} from "./cursor"
export {SearchCursor}

class Query {
  constructor(readonly search: string,
              readonly replace: string,
              readonly caseInsensitive: boolean) {}

  eq(other: Query) {
    return this.search == other.search && this.replace == other.replace && this.caseInsensitive == other.caseInsensitive
  }

  cursor(doc: Text, from = 0, to = doc.length) {
    return new SearchCursor(doc, this.search, from, to, this.caseInsensitive ? x => x.toLowerCase() : undefined)
  }
}

const searchPlugin = ViewPlugin.create(view => new SearchPlugin(view)).decorations(p => p.decorations)

const searchAnnotation = Annotation.define<{query?: Query, dialog?: HTMLElement | false}>()

class SearchPlugin {
  dialog: null | HTMLElement = null
  query = new Query("", "", false)
  decorations = Decoration.none

  constructor(readonly view: EditorView) {}

  update(update: ViewUpdate) {
    let ann = update.annotation(searchAnnotation)
    let changed = ann && (ann.dialog != null || ann.query && ann.query.search != this.query.search)
    if (ann && ann.query) this.query = ann.query
    if (ann && ann.dialog && !this.dialog) this.dialog = ann.dialog
    if (ann && ann.dialog == false) this.dialog = null
    if (!this.query.search || !this.dialog)
      this.decorations = Decoration.none
    else if (changed || update.docChanged || update.transactions.some(tr => tr.selectionSet))
      this.decorations = this.highlight(this.query, update.state, update.viewport)
  }

  highlight(query: Query, state: EditorState, viewport: {from: number, to: number}) {
    let deco = [], cursor = query.cursor(state.doc, Math.max(0, viewport.from - query.search.length),
                                         Math.min(viewport.to + query.search.length, state.doc.length))
    while (!cursor.next().done) {
      let {from, to} = cursor.value
      let selected = state.selection.ranges.some(r => r.from == from && r.to == to)
      deco.push(Decoration.mark(from, to, {class: this.view.cssClass(selected ? "searchMatch.selected" : "searchMatch")}))
    }
    return Decoration.set(deco)
  }
}

export const search = EditorView.extend.unique<null>(() => [
  searchPlugin.extension,
  panels(),
  EditorView.extend.fallback(EditorView.theme(theme))
], null)

export const openSearchPanel: ViewCommand = view => {
  let plugin = view.plugin(searchPlugin)!
  if (!plugin) throw new Error("Search plugin not enabled")
  if (!plugin.dialog) {
    let dialog = buildDialog({
      query: plugin.query,
      phrase(value: string) { return view.phrase(value) },
      close() {
        if (plugin.dialog) {
          if (plugin.dialog.contains(view.root.activeElement)) view.focus()
          view.dispatch(view.state.t().annotate(closePanel(plugin.dialog), searchAnnotation({dialog: false})))
        }
      },
      updateQuery(query: Query) {
        if (!query.eq(plugin.query))
          view.dispatch(view.state.t().annotate(searchAnnotation({query})))
      },
      searchNext() {
        let cursor = plugin.query.cursor(view.state.doc, view.state.selection.primary.from + 1).next()
        if (cursor.done) {
          cursor = plugin.query.cursor(view.state.doc, 0, view.state.selection.primary.from).next()
          if (cursor.done) return
        }
        view.dispatch(view.state.t().setSelection(EditorSelection.single(cursor.value.from, cursor.value.to)).scrollIntoView())
      },
      searchPrev() {
        
      },
      replaceNext() {},
      replaceAll() {}
    })
    view.dispatch(view.state.t().annotate(openPanel({dom: dialog, pos: 80, style: "search"}),
                                          searchAnnotation({dialog})))
  }
  if (plugin.dialog)
    (plugin.dialog.querySelector("[name=search]") as HTMLInputElement).select()
  return true
}

function elt(name: string, props: null | {[prop: string]: any} = null, children: (Node | string)[] = []) {
  let e = document.createElement(name)
  if (props) for (let prop in props) {
    let value = props[prop]
    if (typeof value == "string") e.setAttribute(prop, value)
    else (e as any)[prop] = value
  }
  for (let child of children)
    e.appendChild(typeof child == "string" ? document.createTextNode(child) : child)
  return e
}

function buildDialog(conf: {query: {search: string, replace: string},
                            phrase: (phrase: string) => string,
                            updateQuery: (query: Query) => void,
                            searchNext: () => void,
                            searchPrev: () => void,
                            replaceNext: () => void,
                            replaceAll: () => void,
                            close: () => void}) {
  let onEnter = (f: () => void) => (event: KeyboardEvent) => {
    if (event.keyCode == 13) { event.preventDefault();  f() }
  }
  let searchField = elt("input", {
    value: conf.query.search,
    placeholder: conf.phrase("Find"),
    "aria-label": conf.phrase("Find"),
    name: "search",
    onkeydown: onEnter(conf.searchNext),
    onchange: update,
    onkeyup: update
  }) as HTMLInputElement
  let replaceField = elt("input", {
    value: conf.query.replace,
    placeholder: conf.phrase("Replace"),
    "aria-label": conf.phrase("Replace"),
    name: "replace",
    onkeydown: onEnter(conf.replaceNext),
    onchange: update,
    onkeyup: update
  }) as HTMLInputElement
  function update() {
    conf.updateQuery(new Query(searchField.value, replaceField.value, false))
  }
  let panel = elt("div", {
    onkeydown(e: KeyboardEvent) {
      if (e.keyCode == 27) {
        e.preventDefault()
        conf.close()
      }
    }
  }, [
    searchField, " ",
    elt("button", {name: "next", onclick: conf.searchNext}, [conf.phrase("next")]), " ",
    elt("button", {name: "prev", onclick: conf.searchPrev}, [conf.phrase("previous")]), elt("br"),
    replaceField, " ",
    elt("button", {name: "replace", onclick: conf.replaceNext}, [conf.phrase("replace")]), " ",
    elt("button", {name: "replaceAll", onclick: conf.replaceAll}, [conf.phrase("replace all")]),
    elt("button", {name: "close", onclick: conf.close, "aria-label": conf.phrase("Close")}, ["×"])
  ])
  return panel
}

const theme = {
  "panel.search": {
    padding: "2px 6px 4px",
    position: "relative",
    "& [name=close]": {
      position: "absolute",
      top: "0",
      right: "2px",
      background: "inherit",
      border: "none",
      font: "inherit",
      padding: 0
    },
    "& input, & button": {
      verticalAlign: "middle"
    }
  },

  searchMatch: {
    background: "#ffa"
  },

  "searchMatch.selected": {
    background: "#fca"
  }
}
