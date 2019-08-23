/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const decompress = require("decompress");
const mkdirp = require("mkdirp");
const eventemitter2_1 = require("eventemitter2");
const tmp = require("tmp");
const platform_1 = require("./platform");
const httpClient_1 = require("./httpClient");
const errors_1 = require("./errors");
const util_1 = require("util");
const asyncRetry = require("async-retry");
/*
* Service Download Provider class which handles downloading the service client
*/
class ServiceDownloadProvider {
    constructor(_config) {
        this._config = _config;
        this.httpClient = new httpClient_1.HttpClient();
        this.eventEmitter = new eventemitter2_1.EventEmitter2({ wildcard: true });
        // Ensure our temp files get cleaned up in case of error.
        tmp.setGracefulCleanup();
        this.httpClient.eventEmitter.onAny((e, ...args) => {
            this.eventEmitter.emit(e, ...args);
        });
    }
    /**
     * Returns the download url for given platform
     */
    getDownloadFileName(platform) {
        let fileNamesJson = this._config.downloadFileNames;
        let fileName = fileNamesJson[platform];
        if (fileName === undefined) {
            if (process.platform === 'linux') {
                throw new errors_1.DistributionNotSupportedError('Unsupported linux distribution', process.platform, platform.toString());
            }
            else {
                throw new errors_1.PlatformNotSupportedError(`Unsupported platform: ${process.platform}`, process.platform);
            }
        }
        return fileName;
    }
    /**
     * Returns SQL tools service installed folder.
     */
    getInstallDirectory(platform) {
        let basePath = this._config.installDirectory;
        let versionFromConfig = this._config.version;
        basePath = basePath.replace('{#version#}', versionFromConfig);
        basePath = basePath.replace('{#platform#}', platform_1.getRuntimeDisplayName(platform));
        if (!fs.existsSync(basePath)) {
            mkdirp.sync(basePath);
        }
        return basePath;
    }
    getGetDownloadUrl(fileName) {
        let baseDownloadUrl = this._config.downloadUrl;
        let version = this._config.version;
        baseDownloadUrl = baseDownloadUrl.replace('{#version#}', version);
        baseDownloadUrl = baseDownloadUrl.replace('{#fileName#}', fileName);
        return baseDownloadUrl;
    }
    /**
     * Downloads the service and decompress it in the install folder.
     */
    installService(platform) {
        return __awaiter(this, void 0, void 0, function* () {
            const proxy = this._config.proxy;
            const strictSSL = this._config.strictSSL;
            const fileName = this.getDownloadFileName(platform);
            const installDirectory = this.getInstallDirectory(platform);
            const urlString = this.getGetDownloadUrl(fileName);
            const pkg = {
                installPath: installDirectory,
                url: urlString,
                tmpFile: undefined
            };
            const existsAsync = util_1.promisify(fs.exists);
            const unlinkAsync = util_1.promisify(fs.unlink);
            const downloadAndInstall = () => __awaiter(this, void 0, void 0, function* () {
                try {
                    pkg.tmpFile = yield this.createTempFile(pkg);
                    console.info(`\tdownloading the package: ${pkg.url}`);
                    console.info(`\t                to file: ${pkg.tmpFile.name}`);
                    yield this.httpClient.downloadFile(pkg.url, pkg, proxy, strictSSL);
                    console.info(`\tinstalling the package from file: ${pkg.tmpFile.name}`);
                    yield this.install(pkg);
                }
                finally {
                    // remove the downloaded package file
                    if (yield existsAsync(pkg.tmpFile.name)) {
                        yield unlinkAsync(pkg.tmpFile.name);
                        console.info(`\tdeleted the package file: ${pkg.tmpFile.name}`);
                    }
                }
            });
            // if this._config.retry is not defined then this.withRetry defaults to number of retries of 0
            // which is same as without retries.
            yield withRetry(downloadAndInstall, this._config.retry);
            return true;
        });
    }
    createTempFile(pkg) {
        return new Promise((resolve, reject) => {
            tmp.file({ prefix: 'package-' }, (err, path, fd, cleanupCallback) => {
                if (err) {
                    return reject(new Error('Error from tmp.file'));
                }
                resolve({ name: path, fd: fd, removeCallback: cleanupCallback });
            });
        });
    }
    install(pkg) {
        this.eventEmitter.emit("install_start" /* INSTALL_START */, pkg.installPath);
        return decompress(pkg.tmpFile.name, pkg.installPath).then(() => {
            this.eventEmitter.emit("install_end" /* INSTALL_END */);
        });
    }
}
exports.ServiceDownloadProvider = ServiceDownloadProvider;
function withRetry(promiseToExecute, retryOptions = { retries: 0 }) {
    return __awaiter(this, void 0, void 0, function* () {
        // wrap function execution with a retry promise
        // by default, it retries 10 times while backing off exponentially.
        // retryOptions parameter can be used to configure how many and how often the retries happen.
        // https://www.npmjs.com/package/promise-retry
        return yield asyncRetry((bail, attemptNo) => __awaiter(this, void 0, void 0, function* () {
            try {
                // run the main operation
                return yield promiseToExecute();
            }
            catch (error) {
                if (/403/.test(error)) {
                    // don't retry upon 403
                    bail(error);
                    return;
                }
                if (attemptNo <= retryOptions.retries) {
                    console.warn(`[${(new Date()).toLocaleTimeString('en-US', { hour12: false })}] `
                        + `Retrying...   as attempt:${attemptNo} to run '${promiseToExecute.name}' failed with: '${error}'.`);
                }
                // throw back any other error so it can get retried by asyncRetry as appropriate
                throw error;
            }
        }), retryOptions);
    });
}
//# sourceMappingURL=serviceDownloadProvider.js.map