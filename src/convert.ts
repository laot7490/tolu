import {
	Node,
	Project,
	SyntaxKind,
	Type,
	TypeFormatFlags,
	type InterfaceDeclaration,
	type MethodSignature,
	type TypeAliasDeclaration,
	type TypeNode,
} from "ts-morph";
import { emitLua, type LuaClass, type LuaDecl } from "./emit.js";

const KEYWORD_KINDS = new Set([
	SyntaxKind.StringKeyword,
	SyntaxKind.NumberKeyword,
	SyntaxKind.BooleanKeyword,
	SyntaxKind.AnyKeyword,
	SyntaxKind.UnknownKeyword,
	SyntaxKind.NeverKeyword,
	SyntaxKind.VoidKeyword,
	SyntaxKind.UndefinedKeyword,
	SyntaxKind.NullKeyword,
	SyntaxKind.ObjectKeyword,
	SyntaxKind.BigIntKeyword,
	SyntaxKind.SymbolKeyword,
]);

function pascalCase(name: string): string {
	return name.charAt(0).toUpperCase() + name.slice(1);
}

function singularize(name: string): string {
	if (name.endsWith("ies") && name.length > 3) return `${name.slice(0, -3)}y`;
	if (name.endsWith("s") && !name.endsWith("ss") && name.length > 1) return name.slice(0, -1);
	return name;
}

type ConvertCtx = {
	decls: LuaDecl[];
	seen: Set<string>;
};

function typeNodeToLua(typeNode: TypeNode | undefined, type: Type, parentName: string, fieldName: string, ctx: ConvertCtx): string {
	if (typeNode) {
		if (KEYWORD_KINDS.has(typeNode.getKind())) {
			const text = typeNode.getText();
			if (text === "null" || text === "undefined") return "nil";
			return text;
		}

		if (Node.isLiteralTypeNode(typeNode)) {
			const lit = typeNode.getLiteral();
			if (lit.getKindName() === "NullKeyword") return "nil";
			return typeNode.getText();
		}

		if (Node.isUnionTypeNode(typeNode)) {
			return typeNode
				.getTypeNodes()
				.map((n) => typeNodeToLua(n, n.getType(), parentName, fieldName, ctx))
				.join("|");
		}

		if (Node.isArrayTypeNode(typeNode)) {
			const elem = typeNode.getElementTypeNode();
			const elemField = singularize(fieldName);
			return `${typeNodeToLua(elem, elem.getType(), parentName, elemField, ctx)}[]`;
		}

		if (Node.isTupleTypeNode(typeNode)) {
			const elems = typeNode.getElements().map((el) => {
				const tn = Node.isNamedTupleMember(el) ? el.getTypeNode() : el;
				return typeNodeToLua(tn, tn.getType(), parentName, fieldName, ctx);
			});
			return `[${elems.join(", ")}]`;
		}

		if (Node.isFunctionTypeNode(typeNode)) {
			return functionTypeNodeToLua(typeNode, parentName, fieldName, ctx);
		}

		if (Node.isTypeReference(typeNode)) {
			const typeName = typeNode.getTypeName().getText();
			const args = typeNode.getTypeArguments();

			if (typeName === "Array" && args[0]) {
				const elemField = singularize(fieldName);
				return `${typeNodeToLua(args[0], args[0].getType(), parentName, elemField, ctx)}[]`;
			}

			if (typeName === "Record" && args.length >= 2) {
				const k = typeNodeToLua(args[0]!, args[0]!.getType(), parentName, fieldName, ctx);
				const v = typeNodeToLua(args[1]!, args[1]!.getType(), parentName, fieldName, ctx);
				return `table<${k}, ${v}>`;
			}

			return typeName;
		}

		if (Node.isTypeLiteral(typeNode)) {
			const nestedName = `${parentName}${pascalCase(fieldName)}`;
			hoistObject(
				nestedName,
				typeNode.getProperties().map((p) => ({
					name: p.getName(),
					optional: p.hasQuestionToken(),
					typeNode: p.getTypeNode(),
					type: p.getTypeNode()?.getType() ?? p.getType(),
				})),
				ctx,
			);
			return nestedName;
		}

		if (Node.isParenthesizedTypeNode(typeNode)) {
			const inner = typeNode.getTypeNode();
			return typeNodeToLua(inner, inner.getType(), parentName, fieldName, ctx);
		}

		if (Node.isIntersectionTypeNode(typeNode)) {
			return typeNode
				.getTypeNodes()
				.map((n) => typeNodeToLua(n, n.getType(), parentName, fieldName, ctx))
				.join("&");
		}
	}

	return typeToLua(type, parentName, fieldName, ctx);
}

function functionTypeNodeToLua(
	typeNode: import("ts-morph").FunctionTypeNode,
	parentName: string,
	fieldName: string,
	ctx: ConvertCtx,
): string {
	const params = typeNode.getParameters().map((p) => {
		const n = p.getName();
		const tn = p.getTypeNode();
		const t = tn
			? typeNodeToLua(tn, tn.getType(), parentName, fieldName, ctx)
			: typeToLua(p.getType(), parentName, fieldName, ctx);
		return `${n}: ${t}`;
	});
	const ret = typeNode.getReturnTypeNode();
	if (ret && ret.getText() !== "void") {
		return `fun(${params.join(", ")}): ${typeNodeToLua(ret, ret.getType(), parentName, fieldName, ctx)}`;
	}
	return `fun(${params.join(", ")})`;
}

function methodSignatureToLua(method: MethodSignature, parentName: string, ctx: ConvertCtx): string {
	const params = method.getParameters().map((p) => {
		const n = p.getName();
		const tn = p.getTypeNode();
		const t = tn
			? typeNodeToLua(tn, tn.getType(), parentName, method.getName(), ctx)
			: typeToLua(p.getType(), parentName, method.getName(), ctx);
		return `${n}: ${t}`;
	});
	const ret = method.getReturnTypeNode();
	if (ret && ret.getText() !== "void") {
		return `fun(${params.join(", ")}): ${typeNodeToLua(ret, ret.getType(), parentName, method.getName(), ctx)}`;
	}
	return `fun(${params.join(", ")})`;
}

function typeToLua(type: Type, parentName: string, fieldName: string, ctx: ConvertCtx): string {
	if (type.isNull() || type.getText() === "null") return "nil";
	if (type.isUndefined()) return "nil";
	if (type.isString()) return "string";
	if (type.isNumber()) return "number";
	if (type.isBoolean()) return "boolean";
	if (type.isStringLiteral() || type.isNumberLiteral()) return type.getText();
	if (type.isBooleanLiteral()) return type.getText();

	if (type.isUnion()) {
		const parts = type
			.getUnionTypes()
			.filter((t) => !t.isUndefined())
			.map((t) => typeToLua(t, parentName, fieldName, ctx));
		if (parts.length === 2 && parts.includes("true") && parts.includes("false")) {
			return "boolean";
		}
		return parts.join("|");
	}

	if (type.isTuple()) {
		const elems = type.getTupleElements().map((t) => typeToLua(t, parentName, fieldName, ctx));
		return `[${elems.join(", ")}]`;
	}

	if (type.isArray()) {
		const elem = type.getArrayElementType();
		if (elem) {
			return `${typeToLua(elem, parentName, singularize(fieldName), ctx)}[]`;
		}
	}

	const callSigs = type.getCallSignatures();
	if (callSigs.length > 0) {
		const sig = callSigs[0]!;
		const params = sig.getParameters().map((sym) => {
			const decl = sym.getValueDeclaration();
			const t = decl ? sym.getTypeAtLocation(decl) : sym.getDeclaredType();
			return `${sym.getName()}: ${typeToLua(t, parentName, fieldName, ctx)}`;
		});
		const ret = sig.getReturnType();
		if (ret.getText() !== "void") {
			return `fun(${params.join(", ")}): ${typeToLua(ret, parentName, fieldName, ctx)}`;
		}
		return `fun(${params.join(", ")})`;
	}

	const symbol = type.getAliasSymbol() ?? type.getSymbol();
	if (symbol) {
		const name = symbol.getName();
		if (name === "Array") {
			const args = type.getTypeArguments();
			if (args[0]) return `${typeToLua(args[0], parentName, singularize(fieldName), ctx)}[]`;
		}
		if (name === "Record") {
			const args = type.getTypeArguments();
			if (args.length >= 2) {
				return `table<${typeToLua(args[0]!, parentName, fieldName, ctx)}, ${typeToLua(args[1]!, parentName, fieldName, ctx)}>`;
			}
		}
		if (name !== "__type" && name !== "Object") {
			return name;
		}
	}

	if (type.isObject() && !type.isArray()) {
		const props = type.getProperties();
		if (props.length > 0) {
			const nestedName = `${parentName}${pascalCase(fieldName)}`;
			hoistObject(
				nestedName,
				props.map((sym) => {
					const decl = sym.getValueDeclaration() ?? sym.getDeclarations()[0];
					const typeNode = decl && Node.isPropertySignature(decl) ? decl.getTypeNode() : undefined;
					const t = typeNode?.getType() ?? (decl ? sym.getTypeAtLocation(decl) : sym.getDeclaredType());
					const optional = decl && Node.isPropertySignature(decl) ? decl.hasQuestionToken() : false;
					return { name: sym.getName(), optional, typeNode, type: t };
				}),
				ctx,
			);
			return nestedName;
		}
	}

	return type.getText(undefined, TypeFormatFlags.None);
}

type PropInfo = {
	name: string;
	optional: boolean;
	typeNode: TypeNode | undefined;
	type: Type;
};

function hoistObject(name: string, props: PropInfo[], ctx: ConvertCtx): void {
	if (ctx.seen.has(name)) return;
	ctx.seen.add(name);

	const nested: LuaDecl[] = [];
	const nestedCtx: ConvertCtx = { decls: nested, seen: ctx.seen };
	const fields: LuaClass["fields"] = [];

	for (const prop of props) {
		let luaType = typeNodeToLua(prop.typeNode, prop.type, name, prop.name, nestedCtx);
		if (prop.optional && !luaType.split("|").includes("nil")) {
			luaType = `${luaType}|nil`;
		}
		fields.push({ name: prop.name, type: luaType });
	}

	ctx.decls.push({ kind: "class", name, fields });
	ctx.decls.push(...nested);
}

function collectObjectLike(name: string, props: PropInfo[], ctx: ConvertCtx, parents?: string[]): void {
	if (ctx.seen.has(name)) return;
	ctx.seen.add(name);

	const nested: LuaDecl[] = [];
	const nestedCtx: ConvertCtx = { decls: nested, seen: ctx.seen };
	const fields: LuaClass["fields"] = [];

	for (const prop of props) {
		let luaType = typeNodeToLua(prop.typeNode, prop.type, name, prop.name, nestedCtx);
		if (prop.optional && !luaType.split("|").includes("nil")) {
			luaType = `${luaType}|nil`;
		}
		fields.push({ name: prop.name, type: luaType });
	}

	ctx.decls.push({
		kind: "class",
		name,
		fields,
		...(parents?.length ? { parents } : {}),
	});
	ctx.decls.push(...nested);
}

function collectFromAlias(decl: TypeAliasDeclaration, ctx: ConvertCtx): void {
	const name = decl.getName();
	if (ctx.seen.has(name)) return;

	const typeNode = decl.getTypeNode();
	if (!typeNode) return;

	if (Node.isTypeLiteral(typeNode)) {
		collectObjectLike(
			name,
			typeNode.getProperties().map((p) => ({
				name: p.getName(),
				optional: p.hasQuestionToken(),
				typeNode: p.getTypeNode(),
				type: p.getTypeNode()?.getType() ?? p.getType(),
			})),
			ctx,
		);
		return;
	}

	// unions, primitives, refs, etc. → ---@alias
	ctx.seen.add(name);
	const luaType = typeNodeToLua(typeNode, typeNode.getType(), name, name, ctx);
	ctx.decls.push({ kind: "alias", name, type: luaType });
}

function collectFromInterface(decl: InterfaceDeclaration, ctx: ConvertCtx): void {
	const name = decl.getName();
	if (ctx.seen.has(name)) return;

	const parents = decl
		.getExtends()
		.map((e) => e.getExpression().getText())
		.filter(Boolean);

	const props: PropInfo[] = decl.getProperties().map((p) => ({
		name: p.getName(),
		optional: p.hasQuestionToken(),
		typeNode: p.getTypeNode(),
		type: p.getTypeNode()?.getType() ?? p.getType(),
	}));

	// methods become fun(...) fields
	const methodFields: LuaClass["fields"] = [];
	const nested: LuaDecl[] = [];
	const nestedCtx: ConvertCtx = { decls: nested, seen: ctx.seen };

	for (const method of decl.getMethods()) {
		let luaType = methodSignatureToLua(method, name, nestedCtx);
		if (method.hasQuestionToken() && !luaType.split("|").includes("nil")) {
			luaType = `${luaType}|nil`;
		}
		methodFields.push({ name: method.getName(), type: luaType });
	}

	ctx.seen.add(name);
	const fields: LuaClass["fields"] = [];

	for (const prop of props) {
		let luaType = typeNodeToLua(prop.typeNode, prop.type, name, prop.name, nestedCtx);
		if (prop.optional && !luaType.split("|").includes("nil")) {
			luaType = `${luaType}|nil`;
		}
		fields.push({ name: prop.name, type: luaType });
	}
	fields.push(...methodFields);

	ctx.decls.push({
		kind: "class",
		name,
		fields,
		...(parents.length ? { parents } : {}),
	});
	ctx.decls.push(...nested);
}

export type ConvertOptions = {
	fileName?: string;
};

function collectFromSourceFile(sf: import("ts-morph").SourceFile, ctx: ConvertCtx): void {
	if (sf.isDeclarationFile()) return;

	const decls = [
		...sf.getTypeAliases().map((d) => ({ d, kind: "alias" as const })),
		...sf.getInterfaces().map((d) => ({ d, kind: "interface" as const })),
	].sort((a, b) => a.d.getPos() - b.d.getPos());

	for (const { d, kind } of decls) {
		if (!d.isExported() && !d.isDefaultExport()) continue;
		if (kind === "alias") collectFromAlias(d, ctx);
		else collectFromInterface(d, ctx);
	}
}

export function convertSource(source: string, options: ConvertOptions = {}): string {
	const project = new Project({
		useInMemoryFileSystem: true,
		compilerOptions: {
			strict: true,
			target: 99,
		},
	});

	const sf = project.createSourceFile(options.fileName ?? "input.ts", source);
	const ctx: ConvertCtx = { decls: [], seen: new Set() };
	collectFromSourceFile(sf, ctx);
	return emitLua(ctx.decls);
}

export function convertFiles(filePaths: string[]): string {
	const project = new Project({
		compilerOptions: {
			strict: true,
			target: 99,
		},
	});

	for (const filePath of filePaths) {
		project.addSourceFileAtPath(filePath);
	}

	const ctx: ConvertCtx = { decls: [], seen: new Set() };

	for (const sf of project.getSourceFiles()) {
		collectFromSourceFile(sf, ctx);
	}

	return emitLua(ctx.decls);
}
