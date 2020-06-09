// @flow
import {SysService} from "../entities/sys/Services"
import {worker, WorkerClient} from "./WorkerClient"
import type {Element, HttpMethodEnum, ListElement} from "../common/EntityFunctions"
import {
	_eraseEntity,
	_loadEntity,
	_loadEntityRange,
	_loadMultipleEntities, _loadReverseRangeBetween,
	_setupEntity,
	_updateEntity,
	_verifyType,
	CUSTOM_MIN_ID,
	firstBiggerThanSecond,
	GENERATED_MIN_ID,
	getEtId,
	getLetId,
	HttpMethod,
	RANGE_ITEM_LIMIT,
	resolveTypeReference,
	TypeRef
} from "../common/EntityFunctions"
import {createVersionData} from "../entities/sys/VersionData"
import {RootInstanceTypeRef} from "../entities/sys/RootInstance"
import {VersionReturnTypeRef} from "../entities/sys/VersionReturn"
import {assertMainOrNode} from "../Env"
import EC from "../common/EntityConstants"
import {downcast} from "../common/utils/Utils"
import type {VersionReturn} from "../entities/sys/VersionReturn"
import type {RootInstance} from "../entities/sys/RootInstance"

const Type = EC.Type
const ValueType = EC.ValueType

assertMainOrNode()

// TODO write testcases

type SomeEntity = Element | ListElement

export function setup<T: SomeEntity>(listId: ?Id, instance: T): Promise<Id> {
	return _setupEntity(listId, instance, worker)
}

export function update<T: SomeEntity>(instance: T): Promise<void> {
	return _updateEntity(instance, worker)
}

export function erase<T: SomeEntity>(instance: T): Promise<void> {
	return _eraseEntity(instance, worker)
}

export function load<T: SomeEntity>(typeRef: TypeRef<T>, id: Id | IdTuple, queryParams: ?Params): Promise<T> {
	return _loadEntity(typeRef, id, queryParams, worker)
}

/**
 * load multiple does not guarantee order or completeness of returned elements.
 */
export function loadMultiple<T: SomeEntity>(typeRef: TypeRef<T>, listId: ?Id, elementIds: Id[]): Promise<T[]> {
	return _loadMultipleEntities(typeRef, listId, elementIds, worker)
}

/**
 * load multiple does not guarantee order or completeness of returned elements.
 */
export function loadMultipleList<T: ListElement>(restInterface: EntityRestInterface, typeRef: TypeRef<T>, listId: Id, elementIds: Id[]
): Promise<T[]> {
	return _loadMultipleEntities(typeRef, listId, elementIds, restInterface)
}

export function loadRange<T: ListElement>(typeRef: TypeRef<T>, listId: Id, start: Id, count: number,
                                          reverse: boolean): Promise<T[]> {
	return _loadEntityRange(typeRef, listId, start, count, reverse, worker)
}


export function loadAll<T: ListElement>(typeRef: TypeRef<T>, listId: Id, start: ?Id, end: ?Id): Promise<T[]> {
	return resolveTypeReference(typeRef).then(typeModel => {
		if (!start) {
			start = (typeModel.values["_id"].type === ValueType.GeneratedId) ? GENERATED_MIN_ID : CUSTOM_MIN_ID
		}
		return _loadAll(typeRef, listId, start, end)
	})
}

function _loadAll<T: ListElement>(typeRef: TypeRef<T>, listId: Id, start: Id, end: ?Id): Promise<T[]> {
	return loadRange(typeRef, listId, start, RANGE_ITEM_LIMIT, false).then(elements => {
		if (elements.length === 0) return Promise.resolve(elements)
		let lastElementId = getLetId(elements[elements.length - 1])[1]
		if (elements.length === RANGE_ITEM_LIMIT && (end == null || firstBiggerThanSecond(end, lastElementId[1]))) {
			return _loadAll(typeRef, listId, lastElementId, end).then(nextElements => {
				return elements.concat(nextElements)
			})
		} else {
			return Promise.resolve(elements.filter(e => {
				if (end == null) {
					return true // no end element specified return full list
				} else {
					return firstBiggerThanSecond(end, getLetId(e)[1]) || end === getLetId(e)[1]
				}
			}))
		}
	})
}

export function loadReverseRangeBetween<T: ListElement>(typeRef: TypeRef<T>, listId: Id, start: Id, end: Id, rangeItemLimit: number = RANGE_ITEM_LIMIT): Promise<{elements: T[], loadedCompletely: boolean}> {
	return _loadReverseRangeBetween(typeRef, listId, start, end, worker, rangeItemLimit)
}

export function loadVersion<T>(instance: T, version: Id): Promise<T> {
	return resolveTypeReference((instance: any)._type).then(typeModel => {
		if (!typeModel.versioned) throw new Error("unversioned instance: can't load version")
		return load((instance: any)._type, (instance: any)._id, {version})
	})
}

export function loadVersionInfo<T: SomeEntity>(instance: T): Promise<VersionReturn> {
	return resolveTypeReference((instance: any)._type).then(typeModel => {
		if (!typeModel.versioned) throw new Error("unversioned instance: can't load version info")
		_verifyType(typeModel)
		let versionData = createVersionData()
		versionData.application = typeModel.app
		versionData.typeId = typeModel.id + ""
		if (typeModel.type === Type.ListElement) {
			versionData.id = getLetId(downcast(instance))[1]
			versionData.listId = getLetId(downcast(instance))[0]
		} else {
			versionData.id = getEtId(downcast(instance))
		}
		return serviceRequest(SysService.VersionService, HttpMethod.GET, versionData, VersionReturnTypeRef)
	})
}

export function loadRoot<T: SomeEntity>(typeRef: TypeRef<T>, groupId: Id): Promise<T> {
	return resolveTypeReference(typeRef).then(typeModel => {
		let rootId = [groupId, typeModel.rootId];
		return load(RootInstanceTypeRef, rootId).then((root: RootInstance) => {
			return load(typeRef, root.reference)
		})
	})
}

type Service = SysServiceEnum | TutanotaServiceEnum | MonitorServiceEnum | AccountingServiceEnum

export function serviceRequest<T>(service: Service, method: HttpMethodEnum, requestEntity: ?any, responseTypeRef: TypeRef<T>,
                                  queryParams: ?Params, sk: ?Aes128Key): Promise<T> {
	return worker.serviceRequest(service, method, requestEntity, responseTypeRef, queryParams, sk)
}

export function serviceRequestVoid<T>(service: Service, method: HttpMethodEnum, requestEntity: ?any, queryParams: ?Params,
                                      sk: ?Aes128Key): Promise<void> {
	return worker.serviceRequest(service, method, requestEntity, null, queryParams, sk)
}

export interface API {
	loadElement<T: Element>(typeRef: TypeRef<T>, id: Id): Promise<T>;

	loadListElement<T: ListElement>(typeRef: TypeRef<T>, id: IdTuple): Promise<T>;

	erase<T: Element | ListElement>(entity: T): Promise<void>;
}

// doesn't accept anything for now, should forward to EntityRestInterface
export class ClientsideAPI implements API {
	loadElement<T: Element>(typeRef: TypeRef<T>, id: Id): Promise<T> {
		return load(typeRef, id)
	}

	loadListElement<T: ListElement>(typeRef: TypeRef<T>, id: IdTuple): Promise<T> {
		return load(typeRef, id)
	}

	erase<T: Element | ListElement>(entity: T): Promise<void> {
		return erase(entity)
	}
}