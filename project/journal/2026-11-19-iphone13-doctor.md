# Check the iPhone 13 before a bench run

J435 IP1 walks the USB, pairing, Developer Mode, CoreDevice,
Instruments and SafariDriver checks in order. The shared listener on
4444 is recognized by its SafariDriver process arguments after handoff.
An unrelated listener stops the run.

The attached iPhone14,5 passed every check on iOS 18.6.2. CoreDevice
listed Safari 18.6. The battery read 100% and 35.19 °C. An explicitly
absent USB ID exited 1 at usbmux. The parser tests use captured fields
with the device identifier removed.
