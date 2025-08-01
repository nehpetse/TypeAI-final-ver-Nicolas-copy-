import { db } from '@db'
import { Storage } from '@lib/enums/Storage'
import { Logger } from '@lib/state/Logger'
import { createMMKVStorage } from '@lib/storage/MMKV'
import { AppDirectory, readableFileSize } from '@lib/utils/File'
import { loadLlamaModelInfo } from 'cui-llama.rn'
import { model_data, model_mmproj_links, ModelDataType } from 'db/schema'
import { eq, inArray, notInArray } from 'drizzle-orm'
import { getDocumentAsync } from 'expo-document-picker'
import { copyAsync, deleteAsync, getInfoAsync, readDirectoryAsync } from 'expo-file-system'
import { Platform } from 'react-native'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { GGMLNameMap, GGMLType } from './GGML'

export type ModelData = Omit<ModelDataType, 'id' | 'create_date' | 'last_modified'>
export type ModelListQueryType = Omit<
    Awaited<ReturnType<typeof Model.getModelListQuery2>>[0],
    'mmprojLink'
> & {
    mmprojLink?: {
        model_id: number
        mmproj_id: number
    }
}
const mmprojArchs = ['clip', 'llava']

export namespace Model {
    export const getModelList = async () => {
        return await readDirectoryAsync(AppDirectory.ModelPath)
    }

    export const deleteModelById = async (id: number) => {
        const modelInfo = await db.query.model_data.findFirst({ where: eq(model_data.id, id) })
        if (!modelInfo) return
        // some models may be external
        if (modelInfo.file_path.startsWith(AppDirectory.ModelPath))
            await deleteModel(modelInfo.file)
        await db.delete(model_data).where(eq(model_data.id, id))
    }

    export const isMMPROJ = (arch: string) => {
        return mmprojArchs.includes(arch)
    }

    export const importModel = async () => {
        return getDocumentAsync({
            copyToCacheDirectory: false,
        }).then(async (result) => {
            if (result.canceled) return
            const file = result.assets[0]
            const name = file.name
            const newdir = `${AppDirectory.ModelPath}${name}`
            Logger.infoToast('Importing file...')
            const success = await copyAsync({
                from: file.uri,
                to: newdir,
            })
                .then(() => {
                    return true
                })
                .catch((error) => {
                    Logger.errorToast(`Import Failed: ${error.message}`)
                    return false
                })
            if (!success) return

            // database routine here
            if (await createModelData(name, true)) Logger.infoToast(`Model Imported Sucessfully!`)
        })
    }

    export const linkModelExternal = async () => {
        return getDocumentAsync({
            copyToCacheDirectory: false,
        }).then(async (result) => {
            if (result.canceled) return
            const file = result.assets[0]
            Logger.infoToast('Importing file...')
            if (!file) {
                Logger.errorToast('File Invalid')
                return
            }

            if (await createModelDataExternal(file.uri, file.name, true))
                Logger.infoToast(`Model Imported Sucessfully!`)
        })
    }

    export const getModelExists = async (path: string) => {
        return await getInfoAsync(path)
            .then((result) => result.exists)
            .catch((e) => {
                Logger.error(`${e}`)
                return false
            })
    }

    export const verifyModelList = async () => {
        let modelList = await db.query.model_data.findMany()
        const fileList = await getModelList()

        // cull missing models
        if (Platform.OS === 'android')
            // cull not required on iOS
            modelList.forEach(async (item) => {
                if (item.name === '' || !(await getModelExists(item.file_path))) {
                    Logger.warnToast(`Model Missing, its entry will be deleted: ${item.name}`)
                    await db.delete(model_data).where(eq(model_data.id, item.id))
                }
            })

        // refresh as some may have been deleted
        modelList = await db.query.model_data.findMany()

        // create data as migration step
        fileList.forEach(async (item) => {
            if (modelList.some((model_data) => model_data.file === item)) return
            await createModelData(`${item}`)
        })
    }

    export const createModelData = async (filename: string, deleteOnFailure: boolean = false) => {
        return setModelDataInternal(
            filename,
            `${AppDirectory.ModelPath}${filename}`,
            deleteOnFailure
        )
    }

    export const createModelDataExternal = async (
        newdir: string,
        filename: string,
        deleteOnFailure: boolean = false
    ) => {
        if (!filename) {
            Logger.errorToast('Filename invalid, Import Failed')
            return
        }
        return setModelDataInternal(filename, newdir, deleteOnFailure)
    }

    export const getModelListQuery = () => {
        return db.query.model_data.findMany()
    }

    export const getModelListQuery2 = () => {
        return db.query.model_data.findMany({
            where: notInArray(model_data.architecture, mmprojArchs),
            with: {
                mmprojLink: true,
            },
        })
    }

    export const getMMPROJListQuery = () => {
        return db.query.model_data.findMany({
            where: inArray(model_data.architecture, mmprojArchs),
            with: {
                mmprojLink: true,
            },
        })
    }

    export const getMMPROJLinks = () => {
        return db.query.model_mmproj_links.findMany()
    }

    export const createMMPROJLink = async (
        model: ModelListQueryType,
        mmproj: ModelListQueryType
    ) => {
        await db.insert(model_mmproj_links).values({ model_id: model.id, mmproj_id: mmproj.id })
    }

    export const removeMMPROJLink = async (model: ModelListQueryType) => {
        await db.delete(model_mmproj_links).where(eq(model_mmproj_links.model_id, model.id))
    }

    export const updateName = async (name: string, id: number) => {
        await db.update(model_data).set({ name: name }).where(eq(model_data.id, id))
    }

    export const isInitialEntry = (data: ModelListQueryType) => {
        const initial: ModelData = {
            file: '',
            file_path: '',
            context_length: 0,
            name: 'N/A',
            file_size: 0,
            params: 'N/A',
            quantization: '-1',
            architecture: 'N/A',
        }

        for (const key in initial) {
            if (key === 'file' || key === 'file_path') continue
            const initialV = initial[key as keyof ModelData]
            const dataV = data[key as keyof ModelListQueryType]
            if (initialV !== dataV) return false
        }
        return true
    }

    const initialModelEntry = (filename: string, file_path: string) => ({
        context_length: 0,
        file: filename,
        file_path: file_path,
        name: 'N/A',
        file_size: 0,
        params: 'N/A',
        quantization: '-1',
        architecture: 'N/A',
    })

    const setModelDataInternal = async (
        filename: string,
        file_path: string,
        deleteOnFailure: boolean
    ) => {
        try {
            const [{ id }, ...rest] = await db
                .insert(model_data)
                .values(initialModelEntry(filename, file_path))
                .returning({ id: model_data.id })

            // This will load GGUF KV-pairs
            // refer to https://github.com/ggml-org/ggml/blob/master/docs/gguf.md#standardized-key-value-pairs

            const modelInfo: any = await loadLlamaModelInfo(file_path)
            let fileSize = 0
            const fileResult = await getInfoAsync(file_path)
            if (fileResult.exists) {
                fileSize = fileResult.size
            }
            const modelType = modelInfo?.['general.architecture']
            const modelDataEntry = {
                context_length: modelInfo?.[modelType + '.context_length'] ?? 0,
                file: filename,
                file_path: file_path,
                name: modelInfo?.['general.name'] ?? 'N/A',
                file_size: fileSize,
                params: modelInfo?.['general.size_label'] ?? filename ?? 'N/A',
                quantization: modelInfo?.['general.file_type'] ?? '-1',
                architecture: modelType ?? 'N/A',
            }
            Logger.info(`New Model Data:\n${modelDataText(modelDataEntry)}`)
            await db.update(model_data).set(modelDataEntry).where(eq(model_data.id, id))
            return true
        } catch (e) {
            Logger.errorToast(`Failed to create data: ${e}`)
            if (deleteOnFailure) deleteAsync(file_path, { idempotent: true })
            return false
        }
    }

    const modelDataText = (data: ModelData) => {
        const quantValue = parseInt(data.quantization) as GGMLType
        const quantType = GGMLNameMap[quantValue]
        return `Context length: ${data.context_length ?? 'N/A'}\nFile: ${data.file}\nName: ${data.name ?? 'N/A'}\nSize: ${(data.file_size && readableFileSize(data.file_size)) ?? 'N/A'}\nParams: ${data.params ?? 'N/A'}\nQuantization: ${quantType ?? 'N/A'}\nArchitecture: ${data.architecture ?? 'N/A'}`
    }

    const modelExists = async (modelName: string) => {
        return (await getModelList()).includes(modelName)
    }

    const deleteModel = async (name: string) => {
        if (!(await modelExists(name))) return
        return await deleteAsync(`${AppDirectory.ModelPath}${name}`)
    }
}

type KvVerifyResult = {
    match: boolean
    matchLength: number
    inputLength: number
    cachedLength: number
}

type KVStateProps = {
    kvCacheLoaded: boolean
    kvCacheTokens: number[]
    setKvCacheLoaded: (b: boolean) => void
    setKvCacheTokens: (na: number[]) => void
    verifyKVCache: (na: number[]) => KvVerifyResult
}

export namespace KV {
    export const useKVStore = create<KVStateProps>()(
        persist(
            (set, get) => ({
                kvCacheLoaded: false,
                kvCacheTokens: [],
                setKvCacheLoaded: (b: boolean) => {
                    set((state) => ({ ...state, kvCacheLoaded: b }))
                },
                setKvCacheTokens: (tokens: number[]) => {
                    set((state) => ({ ...state, kvCacheTokens: tokens }))
                },
                verifyKVCache: (tokens: number[]) => {
                    const cachedTokens = get().kvCacheTokens
                    let matched = 0
                    const [a, b] =
                        cachedTokens.length <= tokens.length
                            ? [cachedTokens, tokens]
                            : [tokens, cachedTokens]
                    a.forEach((v, i) => {
                        if (v === b[i]) matched++
                    })
                    return {
                        match: matched === a.length,
                        cachedLength: cachedTokens.length,
                        inputLength: tokens.length,
                        matchLength: matched,
                    }
                },
            }),
            {
                name: Storage.KV,
                partialize: (state) => ({
                    kvCacheTokens: state.kvCacheTokens,
                }),
                storage: createMMKVStorage(),
                version: 1,
            }
        )
    )

    export const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`

    export const getKVSize = async () => {
        const data = await getInfoAsync(sessionFile)
        return data.exists ? data.size : 0
    }

    export const deleteKV = async () => {
        if ((await getInfoAsync(sessionFile)).exists) {
            await deleteAsync(sessionFile)
        }
    }

    export const kvInfo = async () => {
        const data = await getInfoAsync(sessionFile)
        if (!data.exists) {
            Logger.warn('No KV Cache found')
            return
        }
        Logger.info(`Size of KV cache: ${Math.floor(data.size * 0.000001)} MB`)
    }
}
