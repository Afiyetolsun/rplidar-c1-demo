# Third-party notices

The application uses npm packages installed from `package-lock.json`: Three.js (MIT), Express (MIT), SerialPort (MIT), ws (MIT), Barlow Condensed and DM Mono fonts through Fontsource (SIL Open Font License), and development tooling with its respective upstream licenses. Installed packages retain their license files. This source release does not vendor those packages.

The C1 bridge links the [SLAMTEC RPLIDAR SDK](https://github.com/Slamtec/rplidar_sdk), downloaded separately by `setup:lidar`. Its license is reproduced in `SLAMTEC-SDK-LICENSE.txt` and copied next to the compiled bridge. If distributing the compiled bridge, include that notice and the application MIT license along with any notices required by dependencies in your distribution.

No manufacturer firmware, scan recordings, images, audio files, or third-party scene assets are bundled. Fontsource packages supply the interface fonts locally, including their upstream license files.
