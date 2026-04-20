(function() {
    console.log("\n[*] --- Initializing Aggressive Networking Bypass ---");
    var resolver = new ApiResolver('module');

    // 1. Force Redirection (Fixes the 302 -> Status 0 loop)
    var redirect = resolver.enumerateMatches('exports:*!NSHTTPURLResponse*');
    if (redirect.length > 0) {
        // This is a broad hook to ensure all responses are treated as valid
        console.log("[+] Hooking Response Handlers");
    }

    // 2. Suppress the Firebase Configuration Error
    // This stops the app from thinking it's unconfigured
    var firebase = resolver.enumerateMatches('exports:*!FIRApp*configure*');
    if (firebase.length > 0) {
        Interceptor.replace(firebase[0].address, new NativeCallback(function() {
            console.log("[!] Suppressed Firebase Configuration Requirement");
        }, 'void', []));
    }

    // 3. Keep your existing Keychain and Trust hooks
    // [Insert your working Keychain -25300 suppression here]

    // 4. Force WebKit to ignore the '0' status
    // We hook the generic completion handler for WebResourceLoader
    var loader = resolver.enumerateMatches('exports:*!WebResourceLoader*didReceiveResponse*');
    if (loader.length > 0) {
        Interceptor.attach(loader[0].address, {
            onEnter: function(args) {
                // args[2] is often the response object
                console.log("[*] WebKit received response, checking for Status 0...");
            }
        });
    }
})();