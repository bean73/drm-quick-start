(function () {
	"use strict";

	let express = require("express");
	let videoDatabase = require("./VideoDatabase");
	let secretManagement = require("./SecretManagement");
	let jwt = require("jsonwebtoken");
	let crypto = require("crypto");
	let uuid = require("node-uuid");
	let moment = require("moment");

	const NO_SUCH_VIDEO_STATUS_CODE = 400;
	const NEED_TO_KNOW_SECRETS_STATUS_CODE = 500;

	module.exports = {
		"createRouter": function createRouter() {
			let router = express.Router();

			// This API call returns the license token for playing back a video.
			// The web app provides the name of the video as a parameter in the URL.
			router.get("/:videoName", function processGet(request, response) {
				// TODO: Check if the user is actually authorized to watch this video. For example, you could
				// check a database of purchases to see if the currently logged-in user made a relevant purchase
				// for this product. For demo purposes, however, everyone is always authorized to watch every video.

				let video = videoDatabase.getVideoByName(request.params.videoName);

				if (!video) {
					response.status(NO_SUCH_VIDEO_STATUS_CODE).send("No such video");
					return;
				}

				if (video.licenseToken) {
					// If the video has a license token hardcoded, just give that to all callers.
					// Strictly for demo purposes only - never do this in real world usage.
					response.json(video.licenseToken);
					return;
				}

				// If we got here, the user is authorized and we need to generate a license token.

				// NB! In a production implementation, you would retrieve a key container from the key server
				// and embed that, to avoid the keys becoming known to the authorization service. For sample
				// purposes, this is omitted and the keys are directly available in the video database.

				if (!secretManagement.areSecretsAvailable()) {
					console.log("ERROR: You must configure the secrets file to generate license tokens.");
					response.status(NEED_TO_KNOW_SECRETS_STATUS_CODE)
						.send("You must configure the secrets file to generate license tokens.");
					return;
				}

				let secrets = secretManagement.getSecrets();
				let communicationKeyAsBuffer = Buffer.from(secrets.communicationKey, "hex");

				// We allow this token to be used within plus or minus 24 hours. This allows for a lot of
				// clock drift, as your demo servers might not be properly real-time synced across the world.
				// In production scenarios, you should limit the use of the license token much more strictly.
				let now = moment();
				let validFrom = now.clone().subtract(1, "days");
				let validTo = now.clone().add(1, "days");

				// For detailed information about these fields, refer to Axinom DRM documentation.
				let message = {
					"type": "entitlement_message",
					"begin_date": validFrom.toISOString(),
					"expiration_date": validTo.toISOString(),

					// The keys list will be filled below.
					"keys": [
					]
				};

				video.keys.forEach(function (key) {
					// The key is what we encrypt.
					let keyAsBuffer = Buffer.from(key.key, "base64");

					// The Key ID is the IV. Big-endian serialized.
					let keyIdAsBuffer = Buffer.from(uuid.parse(key.keyId));

					// The communication key is the encryption key we use.
					let encryptor = crypto.createCipheriv("aes-256-cbc", communicationKeyAsBuffer, keyIdAsBuffer);
					encryptor.setAutoPadding(false);

					let encryptedKeyAsBuffer = encryptor.update(keyAsBuffer);
					encryptedKeyAsBuffer = Buffer.concat([encryptedKeyAsBuffer, encryptor.final()]);

					message.keys.push({
						"id": key.keyId,
						"encrypted_key": encryptedKeyAsBuffer.toString("base64")
					});
				});

				// For detailed information about these fields, refer to Axinom DRM documentation.
				let envelope = {
					"version": 1,
					"com_key_id": secrets.communicationKeyId,
					"message": message,
					"begin_date": validFrom.toISOString(),
					"expiration_date": validTo.toISOString()
				};

				console.log("Creating license token with payload: " + JSON.stringify(envelope));

				let licenseToken = jwt.sign(envelope, communicationKeyAsBuffer, {
					"algorithm": "HS256"
				});

				response.json(licenseToken);
			});

			return router;
		}
	};
})();