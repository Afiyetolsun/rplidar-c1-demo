# Third-party notices

The application uses npm packages installed from `package-lock.json`: Three.js (MIT), Express (MIT), SerialPort (MIT), ws (MIT), Barlow Condensed and DM Mono fonts through Fontsource (SIL Open Font License), and development tooling with its respective upstream licenses. Installed packages retain their license files. This source release does not vendor those packages.

The C1 bridge links the [SLAMTEC RPLIDAR SDK](https://github.com/Slamtec/rplidar_sdk), downloaded separately by `setup:lidar`. Its license is reproduced in `SLAMTEC-SDK-LICENSE.txt` and copied next to the compiled bridge. If distributing the compiled bridge, include that notice and the application MIT license along with any notices required by dependencies in your distribution.

The optional Firefly firmware is built with ESP-IDF v5.5.1 from the `espressif/idf` Docker image. ESP-IDF is Apache-2.0 and is not included in this source release. The build checks out the [Firefly display component](https://github.com/firefly/component-display) at commit `0f9183f9ebe2d462edf650e1afa70144aa7b87a5` (MIT, Copyright 2024 Richard Moore). That checkout remains in `.deps/` with its upstream license.

No manufacturer firmware, scan recordings, audio files, or third-party scene assets are bundled. Documentation includes one screenshot of the application's synthetic DEMO interface and photographs of the Pixie and Waveshare handheld displays running this firmware. Fontsource packages supply the interface fonts locally, including their upstream license files.
