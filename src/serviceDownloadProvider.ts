/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as fs from 'fs';
import * as decompress from 'decompress';
import * as mkdirp from 'mkdirp';
import { EventEmitter2 as EventEmitter } from 'eventemitter2';
import * as tmp from 'tmp';

import { Runtime, getRuntimeDisplayName } from './platform';
import { IConfig, IPackage, Events } from './interfaces';
import { HttpClient } from './httpClient';
import { PlatformNotSupportedError, DistributionNotSupportedError } from './errors';

/*
* Service Download Provider class which handles downloading the service client
*/
export class ServiceDownloadProvider {

    private httpClient = new HttpClient();
    public readonly eventEmitter = new EventEmitter({ wildcard: true });

    constructor(
        private _config: IConfig
    ) {
        // Ensure our temp files get cleaned up in case of error.
        tmp.setGracefulCleanup();
        this.httpClient.eventEmitter.onAny((e, ...args) => {
            this.eventEmitter.emit(e, ...args);
        });
    }

    /**
     * Returns the download url for given platform
     */
    public getDownloadFileName(platform: Runtime): string {
        let fileNamesJson = this._config.downloadFileNames;
        let fileName = fileNamesJson[platform];

        if (fileName === undefined) {
            if (process.platform === 'linux') {
                throw new DistributionNotSupportedError('Unsupported linux distribution', process.platform, platform.toString());
            } else {
                throw new PlatformNotSupportedError(`Unsupported platform: ${process.platform}`, process.platform);
            }
        }

        return fileName;
    }

    /**
     * Returns SQL tools service installed folder.
     */
    public getInstallDirectory(platform: Runtime): string {
        let basePath = this._config.installDirectory;
        let versionFromConfig = this._config.version;
        basePath = basePath.replace('{#version#}', versionFromConfig);
        basePath = basePath.replace('{#platform#}', getRuntimeDisplayName(platform));
        if (!fs.existsSync(basePath)) {
            mkdirp.sync(basePath);
        }

        return basePath;
    }

    private getGetDownloadUrl(fileName: string): string {
        let baseDownloadUrl = this._config.downloadUrl;
        let version = this._config.version;
        baseDownloadUrl = baseDownloadUrl.replace('{#version#}', version);
        baseDownloadUrl = baseDownloadUrl.replace('{#fileName#}', fileName);
        return baseDownloadUrl;
    }

    /**
     * Downloads the service and decompress it in the install folder.
     */
    public installService(platform: Runtime): Promise<boolean> {
        const proxy = this._config.proxy;
        const strictSSL = this._config.strictSSL;

        return new Promise<boolean>((resolve, reject) => {
            const fileName = this.getDownloadFileName(platform);
            const installDirectory = this.getInstallDirectory(platform);

            const urlString = this.getGetDownloadUrl(fileName);

            let pkg: IPackage = {
                installPath: installDirectory,
                url: urlString,
                tmpFile: undefined
            };
            const downloadAndInstall: () => Promise<void> = async () => {
                await this.httpClient.downloadFile(pkg.url, pkg, proxy, strictSSL);
                await this.install(pkg);
                resolve(true);
            };
            this.createTempFile(pkg).then(tmpResult => {
                pkg.tmpFile = tmpResult;
                if (this._config.retry && this._config.retry.enabled) {
                    this.withRetry(downloadAndInstall, this._config.retry.options);
                } else {
                    downloadAndInstall();
                }

            });
        });
    }

    private createTempFile(pkg: IPackage): Promise<tmp.SynchrounousResult> {
        return new Promise<tmp.SynchrounousResult>((resolve, reject) => {
            tmp.file({ prefix: 'package-' }, (err, path, fd, cleanupCallback) => {
                if (err) {
                    return reject(new Error('Error from tmp.file'));
                }

                resolve(<tmp.SynchrounousResult>{ name: path, fd: fd, removeCallback: cleanupCallback });
            });
        });
    }

    private async install(pkg: IPackage): Promise<void> {
        this.eventEmitter.emit(Events.INSTALL_START, pkg.installPath);
        return decompress(pkg.tmpFile.name, pkg.installPath).then(() => {
            this.eventEmitter.emit(Events.INSTALL_END);
        });
    }

    private async withRetry(promiseToExecute: () => Promise<any>, retryOptions: any = {}): Promise<any> {
        const promiseRetry = require('promise-retry');
        // wrap function execution with a retry promise with its default configuration of 10 retries while backing off exponentially.
        // https://www.npmjs.com/package/promise-retry
        return await promiseRetry(retryOptions, async (retry, attemptNo) => {
            try {
                // run the main operation
                return await promiseToExecute();
            } catch (error) {
                console.warn(`${(new Date()).toLocaleTimeString()}:attempt number:${attemptNo} to run '${promiseToExecute.name}' failed with: '${error}'.`);
                retry(error);
            }
        });
    }
}
